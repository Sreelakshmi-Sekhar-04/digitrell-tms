/**
 * Demo dataset: one fictional shipper, its people, five fictional carriers, four lanes and 31 trips
 * spread over the last 12 weeks, covering every stage of the workflow. All names, numbers, emails
 * (.test domain) and phone numbers are made up. Loaded by `npm run demo:load` (see ./index.ts).
 */

export const DEMO_PASSWORD = 'Demo@123';

export const SHIPPER = { name: 'Vasudha Agro Foods Pvt Ltd', phone: '+919000010000' };

export const USERS = {
  lakshmi: { name: 'Lakshmi Menon', email: 'lakshmi.menon@vasudhafoods.test', phone: '+919000010001', role: 'LOGISTICS_HEAD', approvalLimit: 250000 },
  deepa: { name: 'Deepa Iyer', email: 'deepa.iyer@vasudhafoods.test', phone: '+919000010002', role: 'APPROVER', approvalLimit: 60000 },
  suresh: { name: 'Suresh Babu', email: 'suresh.babu@vasudhafoods.test', phone: '+919000010003', role: 'ACCOUNTS_PAYABLE', approvalLimit: 150000 },
  arjun: { name: 'Arjun Reddy', email: 'arjun.reddy@vasudhafoods.test', phone: '+919000010004', role: 'BOOKING_EXECUTIVE', approvalLimit: null },
  // Invited but has not set a password yet: shows as "Invited" in Users.
  farhan: { name: 'Farhan Sheikh', email: 'farhan.sheikh@vasudhafoods.test', phone: '+919000010005', role: 'BOOKING_EXECUTIVE', approvalLimit: null, invited: true },
} as const;
export type UserKey = keyof typeof USERS;

/** Carriers with their track record (trips, on-time %, days to POD, acceptance %). */
export const CARRIERS = {
  thirumala: { name: 'Thirumala Roadways', phone: '+919000020001', perf: [48, 95, 1.1, 92], code: 'TRW', state: 'TN' },
  godavari: { name: 'Godavari Freight Lines', phone: '+919000020002', perf: [36, 91, 1.6, 89], code: 'GFL', state: 'TS' },
  nilgiri: { name: 'Nilgiri Logistics', phone: '+919000020003', perf: [27, 93, 1.4, 90], code: 'NLG', state: 'KA' },
  shivam: { name: 'Shivam Transport Co', phone: '+919000020004', perf: [31, 84, 3.2, 80], code: 'STC', state: 'MH' },
  konkan: { name: 'Konkan Cargo Movers', phone: '+919000020005', perf: [22, 89, 2.0, 86], code: 'KCM', state: 'MH' },
} as const;
export type CarrierKey = keyof typeof CARRIERS;

export const ADDRESSES = [
  { name: 'Sriperumbudur Plant', city: 'Chennai', line1: 'Plot B-12, SIPCOT Industrial Park, Sriperumbudur', kind: 'PICKUP', contactName: 'Balaji (dispatch)', contactPhone: '+919000030001', hours: '07:00–22:00' },
  { name: 'Whitefield DC', city: 'Bengaluru', line1: 'No. 41, EPIP Zone, Whitefield', kind: 'BOTH', contactName: 'Manjunath (stores)', contactPhone: '+919000030002', hours: '08:00–20:00' },
  { name: 'Bhiwandi Warehouse', city: 'Mumbai', line1: 'Gala 7, Rahnal Village, Bhiwandi', kind: 'PICKUP', contactName: 'Sachin Patil', contactPhone: '+919000030003', hours: '24 h' },
  { name: 'Hinjewadi DC', city: 'Pune', line1: 'Survey 211, Phase 2, Hinjewadi', kind: 'DROP', contactName: 'Nikhil Deshmukh', contactPhone: '+919000030004', hours: '09:00–19:00' },
  { name: 'Kompally DC', city: 'Hyderabad', line1: 'Plot 9, Medchal Road, Kompally', kind: 'DROP', contactName: 'Srinivas Rao', contactPhone: '+919000030005', hours: '08:00–21:00' },
  { name: 'Coimbatore Depot', city: 'Coimbatore', line1: 'SF 88, SIDCO Kurichi', kind: 'DROP', contactName: 'Karthikeyan', contactPhone: '+919000030006', hours: '08:00–18:00' },
] as const;

/** Lanes: addresses, truck type, budget, award rule, approved carriers, transit time and a midway town. */
export const LANES = {
  'CHE-BLR': { from: 'Sriperumbudur Plant', to: 'Whitefield DC', origin: 'Chennai', destination: 'Bengaluru', truckType: '32ft MXL', budget: 45000, awardRule: 'ASK', carriers: ['thirumala', 'godavari', 'nilgiri', 'shivam'], transitH: 9, midway: 'Krishnagiri' },
  'MUM-PUN': { from: 'Bhiwandi Warehouse', to: 'Hinjewadi DC', origin: 'Mumbai', destination: 'Pune', truckType: '20ft SXL', budget: 16000, awardRule: 'AUTO_LOWEST', carriers: ['konkan', 'shivam'], transitH: 5, midway: 'Lonavala' },
  'CHE-HYD': { from: 'Sriperumbudur Plant', to: 'Kompally DC', origin: 'Chennai', destination: 'Hyderabad', truckType: '32ft SXL', budget: 52000, awardRule: 'ASK', carriers: ['thirumala', 'godavari', 'shivam'], transitH: 14, midway: 'Nellore' },
  'BLR-CBE': { from: 'Whitefield DC', to: 'Coimbatore Depot', origin: 'Bengaluru', destination: 'Coimbatore', truckType: '19ft', budget: 21000, awardRule: 'ASK', carriers: ['nilgiri', 'thirumala'], transitH: 8, midway: 'Salem' },
} as const;
export type LaneKey = keyof typeof LANES;

/** How far each trip goes. Stages in order; a trip stops after its `until` stage. */
export const STAGES = ['requested', 'quoted', 'awarded', 'truck', 'transit', 'delivered', 'pod', 'invoiced', 'closed'] as const;
export type Stage = (typeof STAGES)[number];

export type When = { daysAgo: number; at: string } | { hoursAgo: number };

export interface TripSpec {
  lane: LaneKey;
  booked: When;
  by: UserKey;
  material: string;
  tonnes: number;
  /** Units loaded (bags, cartons, tins). */
  units: number;
  reference?: string;
  /** Replies in order: amount, or null to decline. Carriers not listed don't reply. */
  quotes: [CarrierKey, number | null][];
  /** Second round after rejecting every quote (re-tender). */
  retender?: { reason: string; quotes: [CarrierKey, number | null][] };
  /** Who awards which carrier. Omit on an auto-award lane when the rule awards it. */
  award?: { carrier: CarrierKey; by: UserKey };
  until: Stage;
  /** Hours later than promised. */
  lateH?: number;
  exception?: {
    kind: 'BREAKDOWN' | 'ACCIDENT' | 'DELAY' | 'OTHER';
    description: string;
    fix?: { fix: 'SWAP' | 'WAIT' | 'REPAIR' | 'TRANSHIP'; label: string; extraCost: number; payer: 'CARRIER' | 'SHIPPER'; delayH: number };
    /** Shipper-paid fix: left waiting for a decision (trip on hold). */
    pending?: boolean;
  };
  damaged?: number;
  podRemarks?: string;
  claim?: { kind: 'DAMAGE' | 'SHORTAGE'; qty: number; unitValue: number; description: string; accept?: boolean };
  detention?: number;
  /** Carrier bills a different freight amount (e.g. to be queried). */
  invoiceFreight?: number;
  /** Shipper queries the invoice and the trip waits for a corrected one. */
  query?: string;
  pay?: 'UPI' | 'BANK';
  cancel?: { reason: 'ORDER_CANCELLED' | 'WRONG_DETAILS' | 'OTHER_MODE' | 'NO_SUITABLE_QUOTE' | 'OTHER'; note: string; afterH: number };
}

const m = {
  atta: 'Wheat atta (25 kg bags)', rice: 'Sona masoori rice (26 kg bags)', spices: 'Spice powders (cartons)',
  snacks: 'Namkeen snacks (cartons)', oil: 'Groundnut oil (15 L tins)', biscuits: 'Biscuits (cartons)',
};

export const TRIPS: TripSpec[] = [
  // ---------- History: delivered, billed and paid ----------
  { lane: 'CHE-BLR', booked: { daysAgo: 85, at: '09:40' }, by: 'arjun', material: m.atta, tonnes: 16, units: 640, reference: 'PO-VAF-10412',
    quotes: [['thirumala', 43500], ['godavari', 41800], ['nilgiri', 44900], ['shivam', null]], award: { carrier: 'godavari', by: 'lakshmi' }, until: 'closed', pay: 'UPI' },
  { lane: 'MUM-PUN', booked: { daysAgo: 81, at: '10:15' }, by: 'arjun', material: m.spices, tonnes: 7.5, units: 900, reference: 'PO-VAF-10437',
    quotes: [['konkan', 15200], ['shivam', 14800]], award: { carrier: 'shivam', by: 'deepa' }, until: 'closed', pay: 'BANK' },
  { lane: 'CHE-HYD', booked: { daysAgo: 77, at: '11:05' }, by: 'arjun', material: m.rice, tonnes: 18, units: 690, reference: 'PO-VAF-10458',
    quotes: [['thirumala', 50500], ['godavari', 48900], ['shivam', 47200]], award: { carrier: 'thirumala', by: 'lakshmi' }, until: 'closed', lateH: 5, pay: 'BANK' },
  { lane: 'BLR-CBE', booked: { daysAgo: 72, at: '10:30' }, by: 'arjun', material: m.snacks, tonnes: 6, units: 1100, reference: 'PO-VAF-10471',
    quotes: [['nilgiri', 19800], ['thirumala', 20500]], award: { carrier: 'nilgiri', by: 'deepa' }, until: 'closed',
    damaged: 8, podRemarks: '8 cartons crushed at the bottom of the stack',
    claim: { kind: 'DAMAGE', qty: 8, unitValue: 310, description: 'Crushed cartons, contents spilled', accept: true }, pay: 'UPI' },
  { lane: 'MUM-PUN', booked: { daysAgo: 68, at: '09:50' }, by: 'arjun', material: m.oil, tonnes: 9, units: 600, reference: 'PO-VAF-10490',
    quotes: [['konkan', 15400], ['shivam', 14900]], until: 'closed', pay: 'UPI' },
  { lane: 'CHE-BLR', booked: { daysAgo: 64, at: '10:20' }, by: 'arjun', material: m.biscuits, tonnes: 12, units: 1500, reference: 'PO-VAF-10512',
    quotes: [['thirumala', 42900], ['godavari', 41500], ['nilgiri', 44200], ['shivam', 39600]], award: { carrier: 'godavari', by: 'deepa' }, until: 'closed',
    exception: { kind: 'BREAKDOWN', description: 'Clutch plate failure near Vaniyambadi', fix: { fix: 'REPAIR', label: 'Mechanic on site, repair on the spot', extraCost: 0, payer: 'CARRIER', delayH: 4 } }, pay: 'BANK' },
  { lane: 'CHE-HYD', booked: { daysAgo: 59, at: '10:50' }, by: 'lakshmi', material: m.atta, tonnes: 17, units: 680, reference: 'PO-VAF-10533',
    quotes: [['thirumala', 55500], ['godavari', 54800], ['shivam', 53900]],
    retender: { reason: 'Every quote is above our ₹52,000 budget for this lane.', quotes: [['thirumala', 51800], ['godavari', 50900], ['shivam', null]] },
    award: { carrier: 'godavari', by: 'lakshmi' }, until: 'closed', pay: 'BANK' },
  { lane: 'CHE-BLR', booked: { daysAgo: 55, at: '10:00' }, by: 'arjun', material: m.rice, tonnes: 15, units: 575, reference: 'PO-VAF-10551',
    quotes: [['thirumala', 43800], ['godavari', 42200], ['shivam', 40100]], award: { carrier: 'thirumala', by: 'lakshmi' }, until: 'closed', detention: 1500, pay: 'UPI' },
  { lane: 'BLR-CBE', booked: { daysAgo: 50, at: '11:30' }, by: 'arjun', material: m.spices, tonnes: 5, units: 700, reference: 'PO-VAF-10570',
    quotes: [['nilgiri', 19500], ['thirumala', 20900]], award: { carrier: 'nilgiri', by: 'deepa' }, until: 'closed', pay: 'UPI' },
  { lane: 'MUM-PUN', booked: { daysAgo: 46, at: '09:45' }, by: 'arjun', material: m.snacks, tonnes: 6.5, units: 1200, reference: 'PO-VAF-10588',
    quotes: [['konkan', 14900], ['shivam', 15100]], award: { carrier: 'konkan', by: 'deepa' }, until: 'closed', pay: 'BANK' },
  { lane: 'CHE-HYD', booked: { daysAgo: 41, at: '10:10' }, by: 'arjun', material: m.oil, tonnes: 16, units: 1050, reference: 'PO-VAF-10604',
    quotes: [['thirumala', 49800], ['godavari', 48500], ['shivam', 47900]], award: { carrier: 'godavari', by: 'lakshmi' }, until: 'closed', lateH: 9, pay: 'BANK' },
  { lane: 'CHE-BLR', booked: { daysAgo: 36, at: '10:40' }, by: 'arjun', material: m.atta, tonnes: 16, units: 640, reference: 'PO-VAF-10627',
    quotes: [['thirumala', 43200], ['godavari', 41900], ['nilgiri', 44600], ['shivam', 39800]], award: { carrier: 'shivam', by: 'lakshmi' }, until: 'closed',
    damaged: 12, podRemarks: '12 bags short against the LR',
    claim: { kind: 'SHORTAGE', qty: 12, unitValue: 1450, description: '12 bags short at unloading', accept: false }, pay: 'BANK' },
  { lane: 'BLR-CBE', booked: { daysAgo: 29, at: '10:05' }, by: 'arjun', material: m.biscuits, tonnes: 7, units: 900, reference: 'PO-VAF-10649',
    quotes: [['nilgiri', 20100], ['thirumala', 20600]], award: { carrier: 'thirumala', by: 'deepa' }, until: 'closed', pay: 'UPI' },
  { lane: 'MUM-PUN', booked: { daysAgo: 22, at: '09:55' }, by: 'arjun', material: m.atta, tonnes: 10, units: 400, reference: 'PO-VAF-10668',
    quotes: [['konkan', 15300], ['shivam', 14700]], until: 'closed', pay: 'UPI' },
  { lane: 'CHE-HYD', booked: { daysAgo: 16, at: '10:25' }, by: 'arjun', material: m.snacks, tonnes: 12, units: 2000, reference: 'PO-VAF-10690',
    quotes: [['thirumala', 50200], ['godavari', 49400], ['shivam', null]], award: { carrier: 'thirumala', by: 'lakshmi' }, until: 'closed', pay: 'BANK' },
  { lane: 'CHE-BLR', booked: { daysAgo: 12, at: '10:15' }, by: 'arjun', material: m.spices, tonnes: 9, units: 1100, reference: 'PO-VAF-10712',
    quotes: [['thirumala', 42600], ['godavari', 41700], ['nilgiri', 43900], ['shivam', 40200]], award: { carrier: 'godavari', by: 'deepa' }, until: 'closed', pay: 'UPI' },

  // ---------- Cancelled ----------
  { lane: 'CHE-BLR', booked: { daysAgo: 20, at: '10:00' }, by: 'arjun', material: m.rice, tonnes: 14, units: 540, reference: 'PO-VAF-10675',
    quotes: [['thirumala', 43400], ['godavari', 42000]], until: 'quoted', cancel: { reason: 'ORDER_CANCELLED', note: 'Distributor put the order on hold.', afterH: 1.5 } },
  { lane: 'MUM-PUN', booked: { daysAgo: 14, at: '11:20' }, by: 'arjun', material: m.oil, tonnes: 8, units: 530, reference: 'PO-VAF-10701',
    quotes: [['konkan', 15100], ['shivam', 14600]], until: 'awarded', cancel: { reason: 'WRONG_DETAILS', note: 'Booked to the wrong drop point; rebooked.', afterH: 3 } },

  // ---------- Open work: billing ----------
  { lane: 'CHE-HYD', booked: { daysAgo: 9, at: '10:30' }, by: 'arjun', material: m.rice, tonnes: 18, units: 690, reference: 'PO-VAF-10725',
    quotes: [['godavari', 49900], ['thirumala', 50800], ['shivam', 47600]], award: { carrier: 'godavari', by: 'lakshmi' }, until: 'invoiced' },
  { lane: 'CHE-BLR', booked: { daysAgo: 8, at: '11:00' }, by: 'arjun', material: m.atta, tonnes: 16, units: 640, reference: 'PO-VAF-10731',
    quotes: [['thirumala', 44100], ['godavari', 43000], ['nilgiri', 44800]], award: { carrier: 'thirumala', by: 'lakshmi' }, until: 'invoiced', lateH: 3, detention: 2500 },
  { lane: 'BLR-CBE', booked: { daysAgo: 7, at: '09:40' }, by: 'arjun', material: m.snacks, tonnes: 6, units: 1100, reference: 'PO-VAF-10738',
    quotes: [['nilgiri', 19700], ['thirumala', 20400]], award: { carrier: 'nilgiri', by: 'deepa' }, until: 'invoiced', invoiceFreight: 20500,
    query: 'Freight should be ₹19,700 as awarded, not ₹20,500.' },
  { lane: 'MUM-PUN', booked: { daysAgo: 5, at: '10:10' }, by: 'arjun', material: m.spices, tonnes: 7, units: 850, reference: 'PO-VAF-10744',
    quotes: [['konkan', 15000], ['shivam', 14500]], until: 'pod' },
  { lane: 'CHE-BLR', booked: { daysAgo: 3, at: '10:20' }, by: 'arjun', material: m.biscuits, tonnes: 12, units: 1500, reference: 'PO-VAF-10752',
    quotes: [['thirumala', 43300], ['godavari', 41600], ['nilgiri', 44400], ['shivam', 40500]], award: { carrier: 'godavari', by: 'deepa' }, until: 'delivered',
    damaged: 14, podRemarks: '14 cartons wet, rain through a torn tarpaulin',
    claim: { kind: 'DAMAGE', qty: 14, unitValue: 420, description: 'Water-damaged cartons, not saleable' } },

  // ---------- Open work: on the road ----------
  { lane: 'CHE-HYD', booked: { hoursAgo: 30 }, by: 'arjun', material: m.oil, tonnes: 16, units: 1050, reference: 'PO-VAF-10760',
    quotes: [['thirumala', 50600], ['godavari', 49200], ['shivam', 48100]], award: { carrier: 'thirumala', by: 'lakshmi' }, until: 'transit',
    exception: { kind: 'DELAY', description: 'Slow traffic at the Gudur toll plaza', fix: { fix: 'WAIT', label: 'Running about 3 hours late', extraCost: 0, payer: 'CARRIER', delayH: 3 } } },
  { lane: 'CHE-BLR', booked: { hoursAgo: 26 }, by: 'arjun', material: m.rice, tonnes: 15, units: 575, reference: 'PO-VAF-10763',
    quotes: [['thirumala', 43600], ['godavari', 42400], ['nilgiri', 44500], ['shivam', 40300]], award: { carrier: 'godavari', by: 'deepa' }, until: 'transit' },
  { lane: 'BLR-CBE', booked: { hoursAgo: 27 }, by: 'arjun', material: m.biscuits, tonnes: 7, units: 900, reference: 'PO-VAF-10765',
    quotes: [['nilgiri', 19900], ['thirumala', 20700]], award: { carrier: 'nilgiri', by: 'deepa' }, until: 'transit',
    exception: { kind: 'BREAKDOWN', description: 'Gearbox failure on NH 544 near Dharmapuri', pending: true,
      fix: { fix: 'SWAP', label: 'Send a replacement 19ft truck from Salem and transfer the load', extraCost: 4500, payer: 'SHIPPER', delayH: 6 } } },
  { lane: 'MUM-PUN', booked: { hoursAgo: 7 }, by: 'arjun', material: m.atta, tonnes: 10, units: 400, reference: 'PO-VAF-10768',
    quotes: [['konkan', 15200], ['shivam', 14800]], until: 'truck' },

  // ---------- Open work: booking and quotes ----------
  { lane: 'CHE-HYD', booked: { hoursAgo: 3.5 }, by: 'arjun', material: m.atta, tonnes: 17, units: 680, reference: 'PO-VAF-10771',
    quotes: [['thirumala', 50900], ['godavari', 49700], ['shivam', 47900]], award: { carrier: 'godavari', by: 'lakshmi' }, until: 'awarded' },
  { lane: 'CHE-HYD', booked: { hoursAgo: 2.5 }, by: 'arjun', material: m.spices, tonnes: 11, units: 1300, reference: 'PO-VAF-10773',
    quotes: [['thirumala', 55200], ['godavari', 54600], ['shivam', null]], until: 'quoted' },
  { lane: 'CHE-BLR', booked: { hoursAgo: 1.6 }, by: 'arjun', material: m.snacks, tonnes: 8, units: 1400, reference: 'PO-VAF-10775',
    quotes: [['thirumala', 43900], ['godavari', 42700], ['nilgiri', 44300]], until: 'quoted' },
  { lane: 'BLR-CBE', booked: { hoursAgo: 0.5 }, by: 'arjun', material: m.oil, tonnes: 6, units: 400, reference: 'PO-VAF-10777',
    quotes: [], until: 'requested' },
];
