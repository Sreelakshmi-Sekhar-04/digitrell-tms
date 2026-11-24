import { Router } from 'express';
import { Prisma, type ShipperPolicy } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { asyncHandler } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import { requireRole } from '../../middleware/auth';
import { AUTONOMY_AGENTS, DEFAULT_AUTONOMY, MAX_AUTONOMY, POD_RULES, type Autonomy } from './policy.defaults';

export const policiesRouter = Router();

const view = (p: ShipperPolicy) => ({
  paymentApprovalAbove: toNumber(p.paymentApprovalAbove),
  quoteWindowHours: p.quoteWindowHours,
  podRule: p.podRule,
  autonomy: { ...DEFAULT_AUTONOMY, ...(p.autonomy as Partial<Autonomy>) },
  maxAutonomy: MAX_AUTONOMY,
  updatedAt: p.updatedAt,
});

/** Every shipper has a policy row; it is created with defaults on first read. */
export async function getPolicy(companyId: string) {
  return (
    (await prisma.shipperPolicy.findUnique({ where: { companyId } })) ??
    prisma.shipperPolicy.create({ data: { companyId, autonomy: DEFAULT_AUTONOMY } })
  );
}

policiesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ policy: view(await getPolicy(req.user!.companyId)) });
  }),
);

policiesRouter.put(
  '/',
  requireRole('LOGISTICS_HEAD'),
  asyncHandler(async (req, res) => {
    const before = await getPolicy(req.user!.companyId);
    const v = new Validator(req.body);
    const paymentApprovalAbove = v.money('paymentApprovalAbove', 'the payment approval amount', { required: true });
    const quoteWindowHours = v.int('quoteWindowHours', 'the quote window in hours', 1, 48);
    const podRule = v.oneOf('podRule', 'a POD rule', POD_RULES);
    const input = (req.body?.autonomy ?? {}) as Record<string, unknown>;
    const autonomy = { ...DEFAULT_AUTONOMY } as Autonomy;
    for (const agent of AUTONOMY_AGENTS) {
      const lvl = input[agent];
      if (lvl === undefined) {
        autonomy[agent] = ((before.autonomy as Partial<Autonomy>)[agent] ?? DEFAULT_AUTONOMY[agent]) as 0 | 1 | 2;
      } else if (lvl !== 0 && lvl !== 1 && lvl !== 2) {
        v.fail(`autonomy.${agent}`, 'Choose suggest only, ask first or act within limits.');
      } else if (lvl > MAX_AUTONOMY[agent]) {
        v.fail(`autonomy.${agent}`, 'In this release this agent always asks before it acts.');
      } else {
        autonomy[agent] = lvl;
      }
    }
    v.done();
    const p = await prisma.shipperPolicy.update({
      where: { companyId: req.user!.companyId },
      data: { paymentApprovalAbove: new Prisma.Decimal(paymentApprovalAbove!), quoteWindowHours: quoteWindowHours!, podRule: podRule!, autonomy, updatedById: req.user!.id },
    });
    await audit(req.user!.id, 'POLICY_UPDATED', { before: view(before), after: view(p) } as unknown as Prisma.InputJsonValue);
    res.json({ policy: view(p) });
  }),
);
