import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { Validator } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { CHANNELS, LANGUAGES } from '../../shared/masters';

/** "My messages": each person's language, channel, quiet hours and which updates they get (BRD §6 Messaging). */
export const profileRouter = Router();

/** Approvals are not listed: they can't be switched off, they're how work moves. */
export const MESSAGE_TYPES = ['truckConfirmed', 'tracking', 'delivered', 'dailySummary', 'invoices'] as const;
const DEFAULT_PREFS = { truckConfirmed: true, tracking: true, delivered: true, dailySummary: false, invoices: false };
const QUIET = ['', '22:00-07:00', '21:00-08:00', '23:00-06:00'];

profileRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    res.json({ messages: { language: u.language, channel: u.channel, quietHours: u.quietHours ?? '', prefs: { ...DEFAULT_PREFS, ...((u.notifyPrefs ?? {}) as object) } } });
  }),
);

profileRouter.put(
  '/messages',
  asyncHandler(async (req, res) => {
    const v = new Validator(req.body);
    const language = v.oneOf('language', 'a language', LANGUAGES);
    const channel = v.oneOf('channel', 'how you get messages', CHANNELS);
    const quiet = String(req.body?.quietHours ?? '');
    if (!QUIET.includes(quiet)) v.fail('quietHours', 'Choose quiet hours from the list.');
    const raw = (req.body?.prefs ?? {}) as Record<string, unknown>;
    const prefs: Record<string, boolean> = { ...DEFAULT_PREFS };
    for (const k of MESSAGE_TYPES) if (k in raw) prefs[k] = raw[k] === true;
    v.done();
    const u = await prisma.user.update({
      where: { id: req.user!.id },
      data: { language: language!, channel: channel!, quietHours: quiet || null, notifyPrefs: prefs as Prisma.InputJsonValue },
    });
    await audit(req.user!.id, 'MESSAGE_PREFS_UPDATED', { language, channel, quiet: quiet || null });
    res.json({ messages: { language: u.language, channel: u.channel, quietHours: u.quietHours ?? '', prefs } });
  }),
);
