import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, badRequest, unauthorized } from '../../lib/errors';
import { newSessionToken, verifyPassword } from '../../lib/password';
import { requireAuth, sessionUser } from '../../middleware/auth';

const SESSION_HOURS = 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*
 * Sign-in throttling: after MAX_FAILURES wrong attempts for one email within LOCK_MINUTES, further
 * attempts are refused until the window passes. In memory, per API instance; with several
 * instances, move this to a shared store (e.g. Redis) — noted in the final report.
 */
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
const failures = new Map<string, number[]>();
function recent(email: string) {
  const since = Date.now() - LOCK_MINUTES * 60_000;
  const list = (failures.get(email) ?? []).filter((t) => t > since);
  failures.set(email, list);
  return list;
}
const isLockedOut = (email: string) => recent(email).length >= MAX_FAILURES;
const recordFailure = (email: string) => failures.set(email, [...recent(email), Date.now()]);

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

    if (isLockedOut(email)) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Too many failed sign-ins for this email. Try again in ${LOCK_MINUTES} minutes, or ask your logistics head to reset your password.`);
    }
    const user = await prisma.user.findUnique({ where: { email }, include: { company: true } });
    const ok = user && user.isActive && (await verifyPassword(password, user.passwordHash));
    // Same message for unknown email and wrong password, so emails can't be discovered.
    if (!user || !ok) {
      recordFailure(email);
      throw unauthorized('Email or password is incorrect.');
    }
    failures.delete(email);

    const token = newSessionToken();
    await prisma.session.create({ data: { token, userId: user.id, expiresAt: new Date(Date.now() + SESSION_HOURS * 3600_000) } });
    await prisma.auditLog.create({ data: { actor: user.id, action: 'LOGIN', data: { channel: 'web' } } });
    res.json({
      token,
      user: sessionUser(user),
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
