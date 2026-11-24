// Release 1 trip statuses (BRD §5, vendor statuses left out). Change only with lead review.
export const TRIP_STATUSES = [
  'REQUEST_RECEIVED',
  'BOOKED',
  'QUOTES_REQUESTED',
  'QUOTES_RECEIVED',
  'AWARDED',
  'SOURCING_TRUCK',
  'TRUCK_CONFIRMED',
  'CLEARED',
  'READY_FOR_PICKUP',
  'IN_TRANSIT',
  'DELIVERED',
  'POD_RECEIVED',
  'INVOICED',
  'CLOSED',
  'ON_HOLD',
  'CANCELLED',
] as const;

export type TripStatus = (typeof TRIP_STATUSES)[number];
