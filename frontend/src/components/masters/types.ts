export interface CarrierRef {
  id: string;
  name: string;
  status: string;
}
export interface Carrier extends CarrierRef {
  phone: string | null;
  approvedLanes: number;
}
export interface Lane {
  id: string;
  origin: string;
  destination: string;
  truckType: string;
  budget: number | null;
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
  channel: string;
  isActive: boolean;
  status: 'ACTIVE' | 'INVITED' | 'INACTIVE';
}
