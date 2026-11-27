import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { asyncHandler, notFound } from '../../lib/errors';

/** The shipper bell: each user sees only their own notifications, within their company. */
export const notificationsRouter = Router();

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const where = { userId: req.user!.id, companyId: req.user!.companyId };
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    res.json({
      unreadCount,
      notifications: rows.map((n) => ({ id: n.id, kind: n.kind, tripId: n.tripId, title: n.title, body: n.body, read: n.readAt != null, createdAt: n.createdAt })),
    });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, companyId: req.user!.companyId, readAt: null }, data: { readAt: new Date() } });
    res.json({ ok: true, marked: r.count });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const r = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user!.id, companyId: req.user!.companyId, readAt: null }, data: { readAt: new Date() } });
    if (r.count === 0 && !(await prisma.notification.findFirst({ where: { id: req.params.id, userId: req.user!.id } }))) throw notFound('That notification no longer exists.');
    res.json({ ok: true });
  }),
);
