import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'action' | 'progress' | 'success' | 'danger' | 'billing';

const tones: Record<Tone, string> = {
  neutral: 'bg-tone-neutral-bg text-tone-neutral',
  action: 'bg-tone-action-bg text-tone-action',
  progress: 'bg-tone-progress-bg text-tone-progress',
  success: 'bg-tone-success-bg text-tone-success',
  danger: 'bg-tone-danger-bg text-tone-danger',
  billing: 'bg-tone-billing-bg text-tone-billing',
};

/** Status chip: always a word plus a dot, never colour alone. */
export function Chip({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-semibold ${tones[tone]}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Trip status → label and tone, matching the design system's status row. */
export const TRIP_STATUS_UI: Record<string, { label: string; tone: Tone }> = {
  REQUEST_RECEIVED: { label: 'Request received', tone: 'neutral' },
  BOOKED: { label: 'Booked', tone: 'neutral' },
  QUOTES_REQUESTED: { label: 'Quotes requested', tone: 'neutral' },
  QUOTES_RECEIVED: { label: 'Quotes received', tone: 'action' },
  AWARDED: { label: 'Awarded', tone: 'progress' },
  SOURCING_TRUCK: { label: 'Sourcing truck', tone: 'progress' },
  TRUCK_CONFIRMED: { label: 'Truck confirmed', tone: 'progress' },
  CLEARED: { label: 'Cleared', tone: 'progress' },
  READY_FOR_PICKUP: { label: 'Ready for pickup', tone: 'progress' },
  IN_TRANSIT: { label: 'In transit', tone: 'progress' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  POD_RECEIVED: { label: 'POD received', tone: 'success' },
  INVOICED: { label: 'Invoiced', tone: 'billing' },
  CLOSED: { label: 'Closed', tone: 'success' },
  ON_HOLD: { label: 'On hold', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

export function TripStatusChip({ status }: { status: string }) {
  const ui = TRIP_STATUS_UI[status] ?? { label: status, tone: 'neutral' as Tone };
  return <Chip tone={ui.tone}>{ui.label}</Chip>;
}
