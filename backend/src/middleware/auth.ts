import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  companyId: string;
  companyName: string;
  companyType: 'SHIPPER' | 'CARRIER';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionToken?: string;
    }
  }
}

/** Requires a valid `Authorization: Bearer <token>` session. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return next(unauthorized());
    const session = await prisma.session.findUnique({ where: { token }, include: { user: { include: { company: true } } } });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) {
      if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return next(unauthorized('Your session has ended. Please sign in again.'));
    }
    const u = session.user;
    req.user = { id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.companyId, companyName: u.company.name, companyType: u.company.type };
    req.sessionToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

/** Allows only users of a shipper company (this module is shipper-only). */
export function requireShipper(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.companyType !== 'SHIPPER') return next(forbidden('This part of DigitRell is for shipper users.'));
  next();
}
