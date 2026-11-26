export interface CarrierRef {
  id: string;
  name: string;
  status: string;
}
/** A carrier in the shipper's carrier master. */
export interface Carrier extends CarrierRef {
  phone: string | null;
  contactName: string | null;
  contactPhone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  gstin: string | null;
  pan: string | null;
  notes: string | null;
  isActive: boolean;
  approvedLanes: number;
  rateCard: { rates: number; validTo: string | null } | null;
  canEditIdentity: boolean;
}
export interface RateLine {
  id?: string;
  origin: string;
  destination: string;
  truckType: string;
  rate: number | null;
  detentionPerDay: number | null;
  transitDays: number | null;
}
export interface RateCard {
  id: string;
  carrier: CarrierRef;
  validFrom: string | null;
  validTo: string | null;
  validity: 'CURRENT' | 'NOT_STARTED' | 'EXPIRED';
  notes: string | null;
  updatedAt: string;
  lines: RateLine[];
}
export interface Lane {
  id: string;
  origin: string;
  destination: string;
  truckType: string;
  awardRule: string;
  isActive: boolean;
  carriers: CarrierRef[];
}
export interface Address {
  id: string;
  name: string;
  city: string;
  line1: string;
  kind: string;
  contactName: string | null;
  contactPhone: string | null;
  hours: string | null;
  isActive: boolean;
}
export interface TeamUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  approvalLimit: number | null;
  language: string;
  isActive: boolean;
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
}
