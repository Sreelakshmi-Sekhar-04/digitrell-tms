// Mirrors backend/src/shared/masters.ts. Keep the two in step.

export const TRUCK_TYPES = ['14ft', '17ft', '19ft', '20ft SXL', '22ft', '24ft', '32ft SXL', '32ft MXL'] as const;

export const ADDRESS_KIND_LABELS: Record<string, string> = { PICKUP: 'Pickup', DROP: 'Drop', BOTH: 'Pickup and drop' };

export const AWARD_RULE_LABELS: Record<string, string> = {
  ASK: 'Ask me',
  AUTO_LOWEST: 'Lowest within budget, automatic',
};

export const ROLE_OPTIONS = [
  { value: 'BOOKING_EXECUTIVE', label: 'Booking executive', help: 'Creates bookings, tracks trips. Cannot approve.' },
  { value: 'APPROVER', label: 'Approver', help: 'Approves awards, fixes and claims up to a limit.' },
  { value: 'ACCOUNTS_PAYABLE', label: 'Accounts payable', help: 'Approves and pays invoices up to a limit.' },
  { value: 'LOGISTICS_HEAD', label: 'Logistics head', help: 'Everything above, plus users, lanes and policies.' },
] as const;
export const ROLES_WITH_LIMIT = ['LOGISTICS_HEAD', 'APPROVER', 'ACCOUNTS_PAYABLE'];

export const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', hi: 'Hindi', ta: 'Tamil', te: 'Telugu', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi',
};
export const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp, then SMS', whatsapp_email: 'WhatsApp and email', email: 'Email only',
};

/** ₹ with Indian digit grouping, no paise unless present. */
export function rupees(n: number | null | undefined) {
  if (n == null) return '—';
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** "+919876543210" → "+91 98765 43210". */
export function prettyPhone(p: string | null | undefined) {
  if (!p) return '—';
  const m = p.match(/^\+91(\d{5})(\d{5})$/);
  return m ? `+91 ${m[1]} ${m[2]}` : p;
}
