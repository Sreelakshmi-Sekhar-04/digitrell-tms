'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, API_URL, api, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formErrors } from '@/lib/useApi';
import { useToast } from '@/components/ui/Toast';
import { prettyPhone, rupees } from '@/lib/masters';
import { dateTimeIST } from '@/lib/trips';
import { TRUCK_STATUS_UI, hasRole, licenceCovers, type LoadDetail } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';

const errBox = 'mb-3 rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]';

/** Opens the printable LR in a new tab (the API needs the session token, so a plain link will not do). */
export async function openLr(loadId: string) {
  const win = window.open('', '_blank');
  try {
    const token = tokenStore.get();
    const res = await fetch(`${API_URL}/carrier/loads/${loadId}/lr`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('LR not available');
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
    if (win) win.location.href = url;
    else window.open(url, '_blank');
  } catch {
    win?.close();
    alert('The LR could not be opened. Please try again.');
  }
}

/** Won / Truck assigned: pick truck and driver. Compliance blocks need an owner override with a reason. */
export function AssignForm({ load, onDone, changing }: { load: LoadDetail; onDone: () => void; changing?: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const x = load.execution!;
  const opts = x.assignment!;
  const isOwner = hasRole(user, 'OWNER');
  const canAssign = hasRole(user, 'OWNER', 'TRAFFIC_MANAGER');
  const [truckId, setTruckId] = useState(x.truckId ?? '');
  const [driverId, setDriverId] = useState(x.driverId ?? '');
  const [reason, setReason] = useState('');
  const [blockedMsg, setBlockedMsg] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const truck = opts.trucks.find((t) => t.id === truckId);
  const driver = opts.drivers.find((d) => d.id === driverId);
  // Only trucks and drivers that can take this load right now: right truck type, documents valid, not on
  // another trip; drivers free with a valid licence whose class covers the chosen truck. The truck and
  // driver already on this load always stay in the list so a change can be undone.
  const readyTrucks = opts.trucks.filter((t) => t.id === x.truckId || (t.matchesType && (t.status === 'READY' || t.status === 'EXPIRING')));
  const readyDrivers = opts.drivers.filter((d) => d.id === x.driverId || (d.status === 'FREE' && (!truck || licenceCovers(d.licenceClass, truck))));
  const flagged = [truck?.status === 'BLOCKED' ? `${truck.number}: ${truck.note}` : '', driver?.status === 'BLOCKED' ? `${driver.name}: ${driver.note}` : ''].filter(Boolean).join('; ');
  const issue = blockedMsg || (flagged ? `Cannot assign without an override: ${flagged}.` : '');

  const pickTruck = (id: string) => {
    setTruckId(id);
    setBlockedMsg('');
    const t = opts.trucks.find((o) => o.id === id);
    const usual = t?.usualDriverId ? opts.drivers.find((d) => d.id === t.usualDriverId) : undefined;
    const cur = opts.drivers.find((d) => d.id === driverId);
    // A chosen driver whose licence doesn't cover the new truck is cleared.
    if (cur && t && cur.id !== x.driverId && !licenceCovers(cur.licenceClass, t)) setDriverId('');
    if (usual && usual.status === 'FREE' && t && licenceCovers(usual.licenceClass, t) && (!driverId || (cur && !licenceCovers(cur.licenceClass, t)))) setDriverId(usual.id);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    setFields({});
    try {
      await api(`/carrier/loads/${load.id}/assign`, {
        method: 'POST',
        json: { truckId, driverId, override: issue && isOwner ? { reason } : undefined },
      });
      toast({ tone: 'success', title: changing ? 'Truck and driver changed.' : 'Truck and driver assigned.', text: 'Next: issue the LR.' });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.body.code === 'COMPLIANCE_BLOCKED') setBlockedMsg(err.body.message);
      else {
        const f = formErrors(err);
        setFields(f.fields);
        setError(f.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!canAssign) return <p className="text-sm text-ink-muted">Only the owner or traffic manager can assign a truck and driver.</p>;
  return (
    <div>
      {error && <p role="alert" className={errBox}>{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField label="Truck" required value={truckId} error={fields.truckId} onChange={(e) => pickTruck(e.target.value)}>
          <option value="">{readyTrucks.length ? 'Select a truck' : `No ${load.truckType ?? ''} truck is ready`}</option>
          {readyTrucks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.number} · {t.truckType}{t.status === 'EXPIRING' ? ` · ${t.note}` : ''}
            </option>
          ))}
        </SelectField>
        <SelectField label="Driver" required value={driverId} error={fields.driverId} onChange={(e) => { setDriverId(e.target.value); setBlockedMsg(''); }}>
          <option value="">{readyDrivers.length ? 'Select a driver' : truck ? `No free driver can drive a ${truck.truckType}` : 'No driver is free'}</option>
          {readyDrivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.licenceClass ?? 'no licence'}
            </option>
          ))}
        </SelectField>
        <div className="text-sm">
          <div className="text-xs text-ink-muted">Driver phone</div>
          <div className="mt-1 font-semibold">{driver ? prettyPhone(driver.phone) : '—'}</div>
          {truck && <div className="mt-1 text-xs text-ink-muted"><Chip tone={TRUCK_STATUS_UI[truck.status].tone}>{TRUCK_STATUS_UI[truck.status].label}</Chip> {truck.status === 'READY' ? 'All documents valid' : truck.note}</div>}
        </div>
      </div>
      {issue && (
        <div role="alert" className="mt-3 rounded-xl border border-[#E9B8B8] bg-tone-danger-bg p-3 text-sm text-[#7A1616]">
          <div className="font-semibold">{issue}</div>
          {isOwner ? (
            <div className="mt-2 max-w-md text-ink">
              <TextField label={`Owner override (${user?.name}) – reason`} required value={reason} error={fields.override} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Insurance renewal paid; papers arrive today" />
              <p className="mt-1 text-xs text-ink-muted">Your name and this reason are recorded in the audit log.</p>
            </div>
          ) : (
            <p className="mt-1">Ask the owner to assign this truck and driver with an override, or pick another.</p>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button loading={busy} disabled={!truckId || !driverId || (!!issue && (!isOwner || !reason.trim()))} onClick={submit}>
          {issue ? 'Assign with owner override' : changing ? 'Change truck and driver' : 'Assign truck and driver'}
        </Button>
      </div>
    </div>
  );
}

/** Runs the LR calls and returns field errors for inline display. */
function useLrCall(load: LoadDetail, onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const call = async (path: string, json: unknown, ok: { title: string; text?: string }) => {
    setBusy(true);
    setError('');
    try {
      await api(`/carrier/loads/${load.id}/${path}`, { method: 'POST', json });
      toast({ tone: 'success', ...ok });
      onDone();
      return {} as Record<string, string>;
    } catch (err) {
      const f = formErrors(err);
      if (!Object.keys(f.fields).length) setError(err instanceof ApiError && err.body.code === 'NO_LR_SERIES' ? 'NO_LR_SERIES' : f.message);
      return f.fields;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, call };
}

const NoSeries = () => (
  <p role="alert" className={errBox}>
    Set your LR series before issuing an LR. <Link href="/carrier/fleet?tab=profile#lr-series" className="underline">Open LR series</Link>
  </p>
);

/** Truck assigned: issue the LR (the carrier numbers it from its own series), or change the truck and driver until then. */
export function AssignedPanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const { user } = useAuth();
  const x = load.execution!;
  const [changing, setChanging] = useState(false);
  const [eway, setEway] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, call } = useLrCall(load, onDone);
  const can = hasRole(user, 'OWNER', 'TRAFFIC_MANAGER');
  const generate = async () => setErrors(await call('lr', { ewayBill: eway || undefined }, { title: 'LR issued.', text: 'The load is ready for pickup.' }));

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Truck assigned · issue the LR</h2>
          <p className="mt-1 text-sm text-ink-muted">{x.truckNumber} with {x.driverName}{x.driverPhone ? ` · ${prettyPhone(x.driverPhone)}` : ''}{x.pickupEta ? ` · at pickup ${dateTimeIST(x.pickupEta)}` : ''}. You can change them until the LR is issued.</p>
        </div>
        <Chip tone="action">Your task</Chip>
      </div>
      {changing ? (
        <div className="mb-4 rounded-xl border border-line-faint p-4">
          <AssignForm load={load} changing onDone={() => { setChanging(false); onDone(); }} />
          <Button variant="ghost" className="mt-2" onClick={() => setChanging(false)}>Cancel change</Button>
        </div>
      ) : (
        <>
          {error === 'NO_LR_SERIES' ? <NoSeries /> : error && <p role="alert" className={errBox}>{error}</p>}
          <div className="flex flex-wrap items-start gap-3">
            <div className="w-64">
              <TextField label="E-way bill number (optional)" inputMode="numeric" disabled={!can} value={eway} onChange={(e) => { setEway(e.target.value.replace(/\D/g, '').slice(0, 14)); setErrors({}); }} error={errors.ewayBill} help="12 digits. You can add it later by voiding and reissuing." />
            </div>
            <Button className="mt-[26px]" loading={busy} disabled={!can} onClick={generate}>Generate LR</Button>
            <Button className="mt-[26px]" variant="secondary" onClick={() => setChanging(true)}>Change truck or driver</Button>
          </div>
          {!can && <p className="mt-2 text-xs text-ink-muted">Only the owner or traffic manager can issue the LR.</p>}
        </>
      )}
    </Card>
  );
}

/** Ready for pickup: the LR number, view/print, and void and reissue (with a reason) until the truck leaves. */
export function ReadyExtras({ load, onDone }: { load: LoadDetail; onDone?: () => void }) {
  const { user } = useAuth();
  const x = load.execution!;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [eway, setEway] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { busy, error, call } = useLrCall(load, () => onDone?.());
  if (!x.lr) return null;
  const can = hasRole(user, 'OWNER', 'TRAFFIC_MANAGER') && load.panel === 'ready';
  const reissue = async () => {
    const f = await call('lr/reissue', { reason, ewayBill: eway || undefined }, { title: 'New LR issued.', text: `${x.lr!.number} is void and will not be used again.` });
    setErrors(f);
    if (!Object.keys(f).length) { setOpen(false); setReason(''); setEway(''); }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">LR {x.lr.number}</h2>
          <p className="text-sm text-ink-muted">Issued {dateTimeIST(x.lr.issuedAt)} · e-way bill {x.lr.ewayBill ?? 'not entered'} · freight {x.awardedAmount != null ? rupees(x.awardedAmount) : '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Button variant="secondary" onClick={() => openLr(load.id)}>View / print LR</Button>
          {can && !open && <Button variant="ghost" onClick={() => setOpen(true)}>Void and reissue</Button>}
        </div>
      </div>
      {open && (
        <div className="mt-3 rounded-xl border border-line-faint p-4">
          {error === 'NO_LR_SERIES' ? <NoSeries /> : error && <p role="alert" className={errBox}>{error}</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextField label="Reason for voiding" required value={reason} onChange={(e) => setReason(e.target.value)} error={errors.reason} />
            <TextField label="E-way bill number (optional)" inputMode="numeric" value={eway} onChange={(e) => setEway(e.target.value.replace(/\D/g, '').slice(0, 14))} error={errors.ewayBill} />
          </div>
          <p className="mt-2 text-xs text-ink-muted">{x.lr.number} is voided and never reused; a new number is issued.</p>
          <div className="mt-3 flex gap-2.5">
            <Button loading={busy} onClick={reissue}>Void and issue new LR</Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setErrors({}); }}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
