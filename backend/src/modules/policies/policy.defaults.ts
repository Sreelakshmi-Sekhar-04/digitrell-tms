/** Agent autonomy levels (BRD §6): 0 suggest only, 1 act after approval, 2 act alone within limits. */
export const AUTONOMY_AGENTS = ['tender', 'bidEvaluation', 'billing'] as const;
export type AutonomyAgent = (typeof AUTONOMY_AGENTS)[number];
export type Autonomy = Record<AutonomyAgent, 0 | 1 | 2>;

/**
 * Release-1 defaults. Awards (bidEvaluation) and payments (billing) stay at "ask first";
 * BRD §7 says awards are always level 1 except lanes with lowest-rate auto-award.
 */
export const DEFAULT_AUTONOMY: Autonomy = { tender: 2, bidEvaluation: 1, billing: 1 };

/**
 * Highest level each agent may be set to in Release 1. Awards can't act alone (BRD §7: the only
 * automatic award is a lane's AUTO_LOWEST rule). Billing may pay alone below the payment limit.
 */
export const MAX_AUTONOMY: Autonomy = { tender: 2, bidEvaluation: 1, billing: 2 };

export const POD_RULES = ['DIGITAL', 'HARD_COPY', 'BOTH'] as const;
