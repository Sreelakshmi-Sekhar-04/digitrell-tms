import { Router } from 'express';
import { Prisma, type Driver, type Truck } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError, asyncHandler, badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { Validator, toNumber } from '../../lib/validate';
import { audit } from '../../lib/audit';
import multer from 'multer';
import { storage } from '../../lib/storage';
import { DOC_KEYS, liveTruckFiles, queueExtraction } from './documents.service';
import { requireCarrierRole } from '../../middleware/auth';
import { LANGUAGES, TRUCK_TYPES } from '../../shared/masters';
import {
  LICENCE_CLASSES, TRUCK_DOCUMENTS, TRUCK_OWNERSHIP, docState, formatTruckNumber, normaliseTruckNumber, type DocState,
} from '../../shared/carrier';

/**
 * Fleet: trucks and drivers (carrier spec C5, C6). Everyone in the carrier can view; the Traffic
 * Manager adds and edits. Documents are typed from the papers until VAHAN / SARATHI access exists.
 */
export const fleetRouter = Router();
const canEditFleet = requireCarrierRole(['TRAFFIC_MANAGER'], 'Only the traffic manager can change trucks and drivers.');

/** Trip statuses during which a truck and driver are busy. */
const BUSY = ['TRUCK_CONFIRMED', 'CLEARED', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'ON_HOLD'] as const;
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

async function busyTrips(carrierId: string) {
  const trips = await prisma.trip.findMany({
    where: { carrierId, status: { in: [...BUSY] } },
    select: { number: true, truckId: true, driverId: true },
  });
  return {
    truck: new Map(trips.filter((t) => t.truckId).map((t) => [t.truckId!, t.number])),
    driver: new Map(trips.filter((t) => t.driverId).map((t) => [t.driverId!, t.number])),
  };
}

// ---------- Trucks ----------

export function truckStatus(t: Truck, onTrip: string | null) {
  const docs = TRUCK_DOCUMENTS.map((d) => ({ key: d.key, label: d.label, expiry: iso(t[d.key]), state: docState(t[d.key]) }));
  const bad = docs.filter((d) => d.state === 'EXPIRED' || d.state === 'MISSING');
  const soon = docs.filter((d) => d.state === 'EXPIRING');
  const dated = docs.filter((d) => d.expiry).sort((a, b) => a.expiry!.localeCompare(b.expiry!));
  let status: 'INACTIVE' | 'BLOCKED' | 'ON_TRIP' | 'EXPIRING' | 'READY';
  let note: string;
  if (!t.isActive) [status, note] = ['INACTIVE', 'Deactivated'];
  else if (bad.length) [status, note] = ['BLOCKED', bad.map((d) => `${d.label} ${d.state === 'EXPIRED' ? 'expired' : 'missing'}`).join(', ')];
  else if (onTrip) [status, note] = ['ON_TRIP', `On ${onTrip}`];
  else if (soon.length) [status, note] = ['EXPIRING', soon.map((d) => `${d.label} expires ${d.expiry}`).join(', ')];
  else [status, note] = ['READY', 'All documents valid'];
  return { docs, status, note, nextExpiry: dated[0] ? { label: dated[0].label, date: dated[0].expiry } : null };
}

type TruckFiles = Map<string, { fileName: string; uploadedAt: string }> | undefined;
const truckView = (t: Truck, onTrip: string | null, drivers: Map<string, string>, files?: TruckFiles) => {
  const st = truckStatus(t, onTrip);
  return {
  id: t.id,
  number: formatTruckNumber(t.number),
  truckType: t.truckType,
  ownership: t.ownership,
  make: t.make,
  capacityKg: toNumber(t.capacityKg),
  ownerName: t.ownerName,
  ownerPhone: t.ownerPhone,
  usualDriver: t.usualDriverId ? { id: t.usualDriverId, name: drivers.get(t.usualDriverId) ?? '—' } : null,
  currentTrip: onTrip,
  isActive: t.isActive,
  ...st,
  docs: st.docs.map((d) => ({ ...d, file: files?.get(d.key) ?? null })),
  };
};

async function readTruck(body: Record<string, unknown>, partial: boolean, carrierId: string) {
  const v = new Validator(body);
  const req = !partial;
  const out: Prisma.TruckUncheckedUpdateInput = {};
  if (req || v.has('number')) {
    const raw = v.text('number', 'the truck number', { required: true, max: 20 });
    if (raw) {
      const n = normaliseTruckNumber(raw);
      if (!n) v.fail('number', 'Enter the number as on the RC, e.g. TN 09 BX 4471.');
      else out.number = n;
    }
  }
  if (req || v.has('truckType')) out.truckType = v.oneOf('truckType', 'truck type', TRUCK_TYPES)!;
  if (req || v.has('ownership')) out.ownership = v.oneOf('ownership', 'ownership (own or attached)', TRUCK_OWNERSHIP)!;
  if (v.has('make')) out.make = v.text('make', 'the make and model', { max: 60 });
  if (v.has('capacityKg')) {
    const c = body.capacityKg === '' || body.capacityKg == null ? null : v.decimal('capacityKg', 'the capacity in kg', 500, 60000);
    out.capacityKg = c != null ? new Prisma.Decimal(c) : null;
  }
  for (const d of TRUCK_DOCUMENTS) {
    if (req || v.has(d.key)) out[d.key] = v.date(d.key, `the ${d.label} expiry date`, { required: true });
  }
  if (v.has('ownerName')) out.ownerName = v.text('ownerName', "the owner's name", { max: 80 });
  if (v.has('ownerPhone')) out.ownerPhone = v.phone('ownerPhone', "the owner's mobile");
  if (v.has('usualDriverId')) {
    const id = body.usualDriverId ? String(body.usualDriverId) : null;
    if (id && !(await prisma.driver.findFirst({ where: { id, carrierId, isActive: true } }))) v.fail('usualDriverId', 'Choose one of your active drivers.');
    out.usualDriverId = id;
  }
  if (v.has('isActive')) out.isActive = Boolean(body.isActive);
  // Attached trucks belong to an outside owner who must be named whenever ownership is set.
  if (out.ownership === 'ATTACHED' && !out.ownerName) v.fail('ownerName', "Enter the owner's name for an attached truck.");
  if (out.ownership === 'OWN') {
    out.ownerName = null;
    out.ownerPhone = null;
  }
  v.done();
  return out;
}

async function assertUniqueTruck(number: unknown, exceptId?: string) {
  if (typeof number !== 'string') return;
  const dup = await prisma.truck.findFirst({ where: { number, NOT: exceptId ? { id: exceptId } : undefined } });
  if (dup) throw conflict(`${formatTruckNumber(number)} is already on DigitRell.`, { number: 'This truck is already added. Edit it instead.' });
}

async function driverNames(carrierId: string) {
  const ds = await prisma.driver.findMany({ where: { carrierId }, select: { id: true, name: true } });
  return new Map(ds.map((d) => [d.id, d.name]));
}

fleetRouter.get(
  '/trucks',
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const includeInactive = req.query.includeInactive === 'true';
    const [trucks, busy, names] = await Promise.all([
      prisma.truck.findMany({ where: { carrierId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ isActive: 'desc' }, { number: 'asc' }] }),
      busyTrips(carrierId),
      driverNames(carrierId),
    ]);
    const files = await liveTruckFiles(trucks.map((t) => t.id));
    const list = trucks.map((t) => truckView(t, busy.truck.get(t.id) ?? null, names, files.get(t.id)));
    const order = { BLOCKED: 0, EXPIRING: 1, READY: 2, ON_TRIP: 3, INACTIVE: 4 } as const;
    list.sort((a, b) => order[a.status] - order[b.status] || a.number.localeCompare(b.number));
    res.json({ trucks: list, counts: { total: list.filter((t) => t.isActive).length, ready: list.filter((t) => t.status === 'READY' || t.status === 'EXPIRING').length } });
  }),
);

fleetRouter.post(
  '/trucks',
  canEditFleet,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const data = await readTruck(req.body, false, carrierId);
    await assertUniqueTruck(data.number);
    const t = await prisma.truck.create({ data: { ...(data as Prisma.TruckUncheckedCreateInput), carrierId } });
    await audit(req.user!.id, 'TRUCK_ADDED', { id: t.id, number: t.number });
    res.status(201).json({ truck: truckView(t, null, await driverNames(carrierId), (await liveTruckFiles([t.id])).get(t.id)) });
  }),
);

fleetRouter.patch(
  '/trucks/:id',
  canEditFleet,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const existing = await prisma.truck.findFirst({ where: { id: req.params.id, carrierId } });
    if (!existing) throw notFound('That truck no longer exists.');
    const data = await readTruck(req.body, true, carrierId);
    await assertUniqueTruck(data.number, existing.id);
    const busy = await busyTrips(carrierId);
    if (data.isActive === false && busy.truck.has(existing.id)) throw badRequest(`This truck is on ${busy.truck.get(existing.id)}. Deactivate it after the trip.`);
    const t = await prisma.truck.update({ where: { id: existing.id }, data });
    await audit(req.user!.id, data.isActive === false ? 'TRUCK_DEACTIVATED' : 'TRUCK_UPDATED', {
      id: t.id, changes: Object.keys(data), before: Object.fromEntries(Object.keys(data).map((k) => [k, String(existing[k as keyof Truck] ?? '')])),
    });
    res.json({ truck: truckView(t, busy.truck.get(t.id) ?? null, await driverNames(carrierId), (await liveTruckFiles([t.id])).get(t.id)) });
  }),
);

// ---------- Truck paper uploads (photo or PDF of RC, insurance, permit, fitness, PUC) ----------

const MAX_FILE = 5 * 1024 * 1024;
const FILE_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE, files: 1 } }).single('file');
const readDocKey = (v: string) => {
  if (!(DOC_KEYS as readonly string[]).includes(v)) throw notFound('That document does not exist.');
  return v;
};
const ownTruck = async (id: string, companyId: string) => {
  const t = await prisma.truck.findFirst({ where: { id, carrierId: companyId } });
  if (!t) throw notFound('That truck no longer exists.');
  return t;
};
const liveFile = (truckId: string, docKey: string) =>
  prisma.fileUpload.findFirst({ where: { ownerType: 'TRUCK', ownerId: truckId, docKey, replacedAt: null }, orderBy: { createdAt: 'desc' } });

fleetRouter.post(
  '/trucks/:id/documents/:docKey',
  canEditFleet,
  (req, res, next) =>
    upload(req, res, (err) => {
      if (!err) return next();
      if ((err as { code?: string }).code === 'LIMIT_FILE_SIZE') return next(new HttpError(400, 'FILE_TOO_LARGE', 'That file is over 5 MB. Upload a smaller photo or PDF.'));
      next(err);
    }),
  asyncHandler(async (req, res) => {
    const companyId = req.user!.companyId;
    const docKey = readDocKey(req.params.docKey);
    const truck = await ownTruck(req.params.id, companyId);
    const file = req.file;
    if (!file) throw new HttpError(400, 'NO_FILE', 'Choose a photo or PDF to upload.');
    const ext = FILE_TYPES[file.mimetype];
    if (!ext) throw new HttpError(400, 'FILE_TYPE', 'Upload a JPG, PNG, WebP or PDF file.');
    const key = await storage.save(file.buffer, ext);
    const created = await prisma.$transaction(async (tx) => {
      await tx.fileUpload.updateMany({ where: { ownerType: 'TRUCK', ownerId: truck.id, docKey, replacedAt: null }, data: { replacedAt: new Date() } });
      return tx.fileUpload.create({
        data: { companyId, ownerType: 'TRUCK', ownerId: truck.id, docKey, fileName: file.originalname.slice(0, 120), mimeType: file.mimetype, size: file.size, storageKey: key, uploadedById: req.user!.id },
      });
    });
    await queueExtraction(created.id);
    await audit(req.user!.id, 'TRUCK_DOC_UPLOADED', { truckId: truck.id, docKey, fileId: created.id, fileName: created.fileName });
    res.status(201).json({
      document: { docKey, fileName: created.fileName, mimeType: created.mimeType, size: created.size, uploadedAt: created.createdAt.toISOString(), url: `/carrier/trucks/${truck.id}/documents/${docKey}/file` },
    });
  }),
);

fleetRouter.get(
  '/trucks/:id/documents/:docKey/file',
  asyncHandler(async (req, res) => {
    const docKey = readDocKey(req.params.docKey);
    const truck = await ownTruck(req.params.id, req.user!.companyId);
    const f = await liveFile(truck.id, docKey);
    if (!f) throw notFound('No file has been uploaded for this document.');
    const data = await storage.read(f.storageKey).catch(() => null);
    if (!data) throw notFound('The file could not be found. Please upload it again.');
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${f.fileName.replace(/[^A-Za-z0-9._ -]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(data);
  }),
);

fleetRouter.delete(
  '/trucks/:id/documents/:docKey',
  canEditFleet,
  asyncHandler(async (req, res) => {
    const docKey = readDocKey(req.params.docKey);
    const truck = await ownTruck(req.params.id, req.user!.companyId);
    const f = await liveFile(truck.id, docKey);
    if (!f) throw notFound('No file has been uploaded for this document.');
    // Marked replaced, not deleted: the row and the stored file stay for the audit trail.
    await prisma.fileUpload.update({ where: { id: f.id }, data: { replacedAt: new Date() } });
    await audit(req.user!.id, 'TRUCK_DOC_REMOVED', { truckId: truck.id, docKey, fileId: f.id, fileName: f.fileName });
    res.json({ ok: true });
  }),
);

// ---------- Drivers ----------

function driverView(d: Driver, onTrip: string | null, names: Map<string, string>, me: string) {
  const licenceState: DocState = docState(d.licenceExpiry);
  const blocked = !d.licenceNumber || !d.licenceClass || licenceState === 'EXPIRED' || licenceState === 'MISSING';
  let status: 'INACTIVE' | 'BLOCKED' | 'ON_TRIP' | 'FREE';
  let note: string;
  if (!d.isActive) [status, note] = ['INACTIVE', 'Deactivated'];
  else if (blocked) [status, note] = ['BLOCKED', licenceState === 'EXPIRED' ? 'Licence expired' : 'Licence details missing'];
  else if (onTrip) [status, note] = ['ON_TRIP', `On ${onTrip}`];
  else [status, note] = ['FREE', licenceState === 'EXPIRING' ? `Licence expires ${iso(d.licenceExpiry)}` : 'Licence valid'];
  return {
    id: d.id, name: d.name, phone: d.phone, language: d.language,
    licenceNumber: d.licenceNumber, licenceClass: d.licenceClass, licenceExpiry: iso(d.licenceExpiry), licenceState,
    upi: {
      id: d.upiId,
      verified: !!d.upiVerifiedAt,
      verifiedAt: d.upiVerifiedAt,
      pending: d.pendingUpiId ? { upiId: d.pendingUpiId, byName: names.get(d.pendingUpiById ?? '') ?? 'Someone', byMe: d.pendingUpiById === me } : null,
    },
    currentTrip: onTrip, isActive: d.isActive, status, note,
  };
}

async function userNames(companyId: string) {
  const us = await prisma.user.findMany({ where: { companyId }, select: { id: true, name: true } });
  return new Map(us.map((u) => [u.id, u.name]));
}

function readDriver(body: Record<string, unknown>, partial: boolean) {
  const v = new Validator(body);
  const req = !partial;
  const out: Prisma.DriverUncheckedUpdateInput & { upiId?: string | null } = {};
  if (req || v.has('name')) out.name = v.text('name', "the driver's name", { required: true, max: 80 })!;
  if (req || v.has('phone')) out.phone = v.phone('phone', "the driver's mobile", { required: true })!;
  if (req || v.has('licenceNumber')) {
    const l = v.text('licenceNumber', 'the licence number', { required: true, max: 20 });
    if (l) {
      const n = l.toUpperCase().replace(/[\s-]/g, '');
      // State code + RTO (2) + year (4) + serial (7), e.g. TN0920190012345.
      if (!/^[A-Z]{2}\d{13}$/.test(n)) v.fail('licenceNumber', 'Enter the 15-character licence number, e.g. TN09 2019 0012345.');
      out.licenceNumber = n;
    }
  }
  if (req || v.has('licenceClass')) out.licenceClass = v.oneOf('licenceClass', 'licence vehicle class', LICENCE_CLASSES)!;
  if (req || v.has('licenceExpiry')) out.licenceExpiry = v.date('licenceExpiry', 'the licence expiry date', { required: true });
  if (v.has('language')) out.language = v.oneOf('language', 'a language', LANGUAGES)!;
  if (v.has('upiId')) {
    const u = v.text('upiId', 'the UPI ID', { max: 120 });
    if (u && !UPI_RE.test(u)) v.fail('upiId', 'Enter a UPI ID like ramesh@okaxis.');
    out.upiId = u ? u.toLowerCase() : null;
  }
  if (v.has('isActive')) out.isActive = Boolean(body.isActive);
  v.done();
  return out;
}

async function assertUniqueDriverPhone(phone: unknown, exceptId?: string) {
  if (typeof phone !== 'string') return;
  const dup = await prisma.driver.findFirst({ where: { phone, NOT: exceptId ? { id: exceptId } : undefined } });
  if (dup) throw conflict('A driver with this mobile is already on DigitRell.', { phone: 'This mobile is already used by a driver.' });
}

async function loadDriver(id: string, carrierId: string) {
  const d = await prisma.driver.findFirst({ where: { id, carrierId } });
  if (!d) throw notFound('That driver no longer exists.');
  return d;
}

async function sendDriver(res: import('express').Response, d: Driver, carrierId: string, me: string, status = 200) {
  const [busy, names] = await Promise.all([busyTrips(carrierId), userNames(carrierId)]);
  res.status(status).json({ driver: driverView(d, busy.driver.get(d.id) ?? null, names, me) });
}

fleetRouter.get(
  '/drivers',
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const includeInactive = req.query.includeInactive === 'true';
    const [drivers, busy, names] = await Promise.all([
      prisma.driver.findMany({ where: { carrierId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      busyTrips(carrierId),
      userNames(carrierId),
    ]);
    res.json({ drivers: drivers.map((d) => driverView(d, busy.driver.get(d.id) ?? null, names, req.user!.id)) });
  }),
);

fleetRouter.post(
  '/drivers',
  canEditFleet,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const data = readDriver(req.body, false);
    await assertUniqueDriverPhone(data.phone);
    const d = await prisma.driver.create({ data: { ...(data as Prisma.DriverUncheckedCreateInput), carrierId } });
    await audit(req.user!.id, 'DRIVER_ADDED', { id: d.id, name: d.name });
    await sendDriver(res, d, carrierId, req.user!.id, 201);
  }),
);

fleetRouter.patch(
  '/drivers/:id',
  canEditFleet,
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const existing = await loadDriver(req.params.id, carrierId);
    const data = readDriver(req.body, true);
    await assertUniqueDriverPhone(data.phone, existing.id);
    const busy = await busyTrips(carrierId);
    if (data.isActive === false && busy.driver.has(existing.id)) throw badRequest(`This driver is on ${busy.driver.get(existing.id)}. Deactivate them after the trip.`);

    // UPI: the first ID is saved directly (unverified). Changing an existing ID waits for a second
    // person to approve (maker-checker, carrier spec C6), so advances can't be redirected by one person.
    let upiNote: string | undefined;
    if ('upiId' in data) {
      const next = data.upiId;
      delete data.upiId;
      if (next !== existing.upiId) {
        if (!existing.upiId) {
          Object.assign(data, { upiId: next, upiVerifiedAt: null });
        } else if (!next) {
          throw badRequest('A UPI ID can be changed but not removed. Enter the new ID.');
        } else {
          Object.assign(data, { pendingUpiId: next, pendingUpiById: req.user!.id });
          upiNote = 'pending';
        }
      }
    }
    const d = await prisma.driver.update({ where: { id: existing.id }, data });
    await audit(req.user!.id, upiNote ? 'DRIVER_UPI_CHANGE_REQUESTED' : data.isActive === false ? 'DRIVER_DEACTIVATED' : 'DRIVER_UPDATED', {
      id: d.id, changes: Object.keys(data), ...(upiNote ? { from: existing.upiId, to: d.pendingUpiId } : {}),
    });
    await sendDriver(res, d, carrierId, req.user!.id);
  }),
);

/** A second person approves a UPI change. The new ID starts unverified. */
fleetRouter.post(
  '/drivers/:id/upi/approve',
  requireCarrierRole(['TRAFFIC_MANAGER', 'OWNER'], 'Only the traffic manager or owner can approve a UPI change.'),
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const d = await loadDriver(req.params.id, carrierId);
    if (!d.pendingUpiId) throw badRequest('There is no UPI change waiting for approval.');
    if (d.pendingUpiById === req.user!.id) throw forbidden('You asked for this change, so someone else must approve it.');
    const updated = await prisma.driver.update({
      where: { id: d.id },
      data: { upiId: d.pendingUpiId, upiVerifiedAt: null, pendingUpiId: null, pendingUpiById: null },
    });
    await audit(req.user!.id, 'DRIVER_UPI_CHANGE_APPROVED', { id: d.id, from: d.upiId, to: d.pendingUpiId, requestedBy: d.pendingUpiById });
    await sendDriver(res, updated, carrierId, req.user!.id);
  }),
);

fleetRouter.post(
  '/drivers/:id/upi/reject',
  requireCarrierRole(['TRAFFIC_MANAGER', 'OWNER'], 'Only the traffic manager or owner can reject a UPI change.'),
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const d = await loadDriver(req.params.id, carrierId);
    if (!d.pendingUpiId) throw badRequest('There is no UPI change waiting for approval.');
    const updated = await prisma.driver.update({ where: { id: d.id }, data: { pendingUpiId: null, pendingUpiById: null } });
    await audit(req.user!.id, 'DRIVER_UPI_CHANGE_REJECTED', { id: d.id, rejected: d.pendingUpiId });
    await sendDriver(res, updated, carrierId, req.user!.id);
  }),
);

/**
 * Records that a ₹1 test payment to the UPI ID went through (spec C6). The payment itself is sent
 * outside DigitRell until a payment provider is connected, so the bank reference is required.
 */
fleetRouter.post(
  '/drivers/:id/upi/verify',
  requireCarrierRole(['TRAFFIC_MANAGER', 'OWNER', 'ACCOUNTS'], 'Your role cannot verify a UPI ID.'),
  asyncHandler(async (req, res) => {
    const carrierId = req.user!.companyId;
    const d = await loadDriver(req.params.id, carrierId);
    if (!d.upiId) throw badRequest('Add a UPI ID before verifying it.');
    if (d.upiVerifiedAt) throw badRequest('This UPI ID is already verified.');
    const v = new Validator(req.body);
    const reference = v.text('reference', 'the UPI reference of the ₹1 test payment', { required: true, max: 40 });
    if (reference && !/^[A-Za-z0-9]{6,40}$/.test(reference)) v.fail('reference', 'Enter the UPI reference (UTR) from your bank app, letters and digits only.');
    v.done();
    const updated = await prisma.driver.update({ where: { id: d.id }, data: { upiVerifiedAt: new Date() } });
    await audit(req.user!.id, 'DRIVER_UPI_VERIFIED', { id: d.id, upiId: d.upiId, reference });
    await sendDriver(res, updated, carrierId, req.user!.id);
  }),
);
