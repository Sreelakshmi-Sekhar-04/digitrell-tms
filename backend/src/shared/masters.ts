// Shared lists used by the API and (copied) by the web app. Change only with lead review.

export const TRUCK_TYPES = ['14ft', '17ft', '19ft', '20ft SXL', '22ft', '24ft', '32ft SXL', '32ft MXL'] as const;

export const ADDRESS_KINDS = ['PICKUP', 'DROP', 'BOTH'] as const;

export const AWARD_RULES = ['ASK', 'AUTO_LOWEST'] as const;

/**
 * Shipper roles. LOGISTICS_HEAD manages settings and users and approves up to a limit;
 * APPROVER approves up to a limit; ACCOUNTS_PAYABLE approves payments up to a limit;
 * BOOKING_EXECUTIVE books and tracks but cannot approve.
 */
export const SHIPPER_ROLES = ['LOGISTICS_HEAD', 'APPROVER', 'ACCOUNTS_PAYABLE', 'BOOKING_EXECUTIVE'] as const;
export type ShipperRole = (typeof SHIPPER_ROLES)[number];
export const ROLES_WITH_LIMIT: readonly ShipperRole[] = ['LOGISTICS_HEAD', 'APPROVER', 'ACCOUNTS_PAYABLE'];

export const LANGUAGES = ['en', 'hi', 'ta', 'te', 'kn', 'ml', 'mr'] as const;
