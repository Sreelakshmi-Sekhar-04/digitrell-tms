'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formErrors } from '@/lib/useApi';
import { useToast } from '@/components/ui/Toast';
import { prettyPhone, rupees } from '@/lib/masters';
import { dateTimeIST } from '@/lib/trips';
import { hasRole, licenceCovers, type LoadDetail } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card } from '@/components/ui/Card';
import { SelectField, TextField } from '@/components/ui/Field';

export const errBox = 'mb-3 rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]';
const iso = (local: string) => (local ? new Date(local).toISOString() : undefined);

/** POSTs to the carrier API and keeps the busy flag, the form-level message and the per-field messages. */
export function useCall(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [code, setCode] = useState('');
  const run = async (path: string, json: unknown, success?: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    setFields({});
    setCode('');
    try {
      await api(path, { method: 'POST', json });
      if (success) toast({ tone: 'success', title: success });
      onDone();
      return true;
    } catch (err) {
      const f = formErrors(err);
      setFields(f.fields);
      setError(f.message);
      setCode((err as { body?: { code?: string } })?.body?.code ?? '');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy, error, fields, code };
}

function useCanRun() {
  const { user } = useAuth();
  return hasRole(user, 'OWNER', 'TRAFFIC_MANAGER');
}

/** The event timeline: what was recorded, newest last. */
export function EventTimeline({ load }: { load: LoadDetail }) {
  const ev = load.execution?.tracking.events ?? [];
  if (!ev.length) return <p className="text-sm text-ink-muted">Nothing recorded yet.</p>;
  return (
    <ol aria-label="Trip events" className="flex flex-col gap-2 text-sm" data-testid="event-timeline">
      {ev.map((e, i) => (
        <li key={i} className="grid grid-cols-[110px_1fr] gap-2">
          <span className="text-xs text-ink-muted tabular">{dateTimeIST(e.at)}</span>
          <span><span className="font-semibold">{e.label}</span>{e.location ? ` · ${e.location}` : ''}{e.eta ? ` · ETA ${dateTimeIST(e.eta)}` : ''}{e.detail ? ` · ${e.detail}` : ''}</span>
        </li>
      ))}
    </ol>
  );
}

function Facts({ load }: { load: LoadDetail }) {
  const x = load.execution!;
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div><div className="text-xs text-ink-muted">ETA at drop</div><div className="text-lg font-bold">{x.eta ? dateTimeIST(x.eta) : '—'}</div></div>
      <div><div className="text-xs text-ink-muted">Last update</div><div className="font-semibold">{x.lastLocation ?? 'No location yet'}</div>{x.lastUpdateAt && <div className="text-xs text-ink-muted">{dateTimeIST(x.lastUpdateAt)}</div>}</div>
      <div><div className="text-xs text-ink-muted">Truck</div><div className="font-semibold">{x.truckNumber ?? '—'}</div></div>
      <div><div className="text-xs text-ink-muted">Driver</div><div className="font-semibold">{x.driverName ?? '—'}{x.driverPhone ? ` · ${prettyPhone(x.driverPhone)}` : ''}</div></div>
    </div>
  );
}

/** Report a breakdown, accident, delay or other problem. A delay with a new ETA is only a notice; the rest puts the load on hold. */
function ProblemForm({ load, onDone, onCancel }: { load: LoadDetail; onDone: () => void; onCancel: () => void }) {
  const c = useCall(onDone);
  const [kind, setKind] = useState('BREAKDOWN');
  const [description, setDescription] = useState('');
  const [eta, setEta] = useState('');
  const submit = () =>
    c.run(
      `/carrier/loads/${load.id}/exceptions`,
      { kind, description, proposal: kind === 'DELAY' && eta ? { fix: 'WAIT', label: 'Delayed; new ETA given', newEta: iso(eta), extraCost: 0, payer: 'CARRIER' } : undefined },
      kind === 'DELAY' && eta ? 'Delay noted. The shipper sees the new ETA.' : 'Problem reported. The load is on hold: propose a fix.',
    );
  return (
    <div className="mt-4 rounded-xl border border-line-faint p-4">
      <h3 className="mb-2 text-base font-bold">Report a problem</h3>
      {c.error && <p role="alert" className={errBox}>{c.error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SelectField label="What happened" value={kind} error={c.fields.kind} onChange={(e) => setKind(e.target.value)}>
          <option value="BREAKDOWN">Breakdown</option>
          <option value="ACCIDENT">Accident</option>
          <option value="DELAY">Delay</option>
          <option value="OTHER">Other</option>
        </SelectField>
        <TextField label="Details" required value={description} error={c.fields.description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Clutch failure near Krishnagiri" />
        {kind === 'DELAY' && <TextField label="New ETA at drop" optional type="datetime-local" value={eta} error={c.fields['proposal.newEta']} onChange={(e) => setEta(e.target.value)} />}
      </div>
      <p className="mt-2 text-xs text-ink-muted">{kind === 'DELAY' ? 'A delay with a new ETA is just a notice to the shipper.' : 'The load goes on hold until the fix is agreed and carried out.'}</p>
      <div className="mt-3 flex gap-3"><Button loading={c.busy} onClick={submit}>Report problem</Button><Button variant="ghost" onClick={onCancel}>Back</Button></div>
    </div>
  );
}

/** Ready for pickup and In transit: record the steps in order, show the timeline. */
export function RoadPanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const canRun = useCanRun();
  const x = load.execution!;
  const ready = load.panel === 'ready';
  const c = useCall(onDone);
  const [eta, setEta] = useState('');
  const [where, setWhere] = useState('');
  const [locEta, setLocEta] = useState('');
  const [good, setGood] = useState('');
  const [damaged, setDamaged] = useState('0');
  const [remarks, setRemarks] = useState('');
  const [problem, setProblem] = useState(false);
  const post = (path: string, body: unknown, ok: string) => c.run(`/carrier/loads/${load.id}/${path}`, body, ok);
  const reachedPickup = x.tracking.reachedPickup;
  const reachedDrop = x.tracking.reachedDrop;

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{ready ? (reachedPickup ? 'At pickup' : 'Truck confirmed, going for pickup') : reachedDrop ? 'At the drop' : 'On the road'}</h2>
        <Chip tone="progress">{load.label}</Chip>
      </div>
      <Facts load={load} />
      <div className="mt-4">
        <h3 className="mb-2 text-sm font-bold">Events</h3>
        <EventTimeline load={load} />
      </div>
      {c.error && !problem && <p role="alert" className={`${errBox} mt-4`}>{c.error}</p>}
      {!canRun ? (
        <p className="mt-4 text-sm text-ink-muted">Only the owner or traffic manager can record trip steps.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          {ready && !reachedPickup && (
            <div className="flex flex-wrap items-center gap-3">
              <Button loading={c.busy} onClick={() => post('events', { type: 'REACHED_PICKUP' }, 'Reached pickup recorded.')}>Reached pickup</Button>
              <span className="text-xs text-ink-muted">Record this when the truck reaches {load.pickup?.name ?? 'the pickup'}.</span>
            </div>
          )}
          {ready && reachedPickup && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-full max-w-xs"><TextField label="Expected arrival at drop" required type="datetime-local" value={eta} error={c.fields.eta} onChange={(e) => setEta(e.target.value)} /></div>
              <Button loading={c.busy} onClick={() => post('events', { type: 'LOADED', eta: iso(eta) }, 'Loaded. The trip is in transit.')}>Loaded: start trip</Button>
            </div>
          )}
          {!ready && !reachedDrop && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-full max-w-xs"><TextField label="Where is the truck" value={where} error={c.fields.location} onChange={(e) => setWhere(e.target.value)} placeholder="e.g. Solapur bypass" /></div>
                <div className="w-full max-w-xs"><TextField label="New ETA at drop" optional type="datetime-local" value={locEta} error={c.fields.eta} onChange={(e) => setLocEta(e.target.value)} /></div>
                <Button variant="secondary" loading={c.busy} onClick={() => post('events', { type: 'LOCATION', location: where, eta: iso(locEta) }, 'Location updated.').then((ok) => ok && (setWhere(''), setLocEta('')))}>Update location</Button>
              </div>
              <div><Button loading={c.busy} onClick={() => post('events', { type: 'REACHED_DROP' }, 'Reached drop recorded.')}>Reached drop</Button></div>
            </>
          )}
          {!ready && reachedDrop && (
            <div>
              <h3 className="mb-2 text-sm font-bold">Delivered</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <TextField label="Units in good order" required inputMode="numeric" value={good} error={c.fields.goodQty} onChange={(e) => setGood(e.target.value)} />
                <TextField label="Damaged or short" required inputMode="numeric" value={damaged} error={c.fields.damagedQty} onChange={(e) => setDamaged(e.target.value)} />
                <TextField label="Remarks" optional value={remarks} error={c.fields.remarks} onChange={(e) => setRemarks(e.target.value)} />
              </div>
              <Button className="mt-3" loading={c.busy} onClick={() => post('delivered', { goodQty: good, damagedQty: damaged, remarks: remarks || undefined }, 'Delivered. Next: upload the signed POD.')}>Mark delivered</Button>
            </div>
          )}
          {!ready && !problem && <div><Button variant="ghost" onClick={() => setProblem(true)}>Report breakdown or delay</Button></div>}
        </div>
      )}
      {problem && <ProblemForm load={load} onDone={onDone} onCancel={() => setProblem(false)} />}
    </Card>
  );
}

/** On hold: the problem, the proposed fix and its state, a form to propose or change it, and Resume once it is done. */
export function HoldPanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const { user } = useAuth();
  const canRun = useCanRun();
  const isOwner = hasRole(user, 'OWNER');
  const x = load.execution!;
  const ex = x.exception;
  const p = ex?.proposal ?? null;
  const c = useCall(onDone);
  const [changing, setChanging] = useState(false);
  const [fix, setFix] = useState('SWAP');
  const [label, setLabel] = useState('');
  const [eta, setEta] = useState('');
  const [cost, setCost] = useState('');
  const [payer, setPayer] = useState('CARRIER');
  const [truckId, setTruckId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [reason, setReason] = useState('');
  const [resumeEta, setResumeEta] = useState('');
  const opts = x.swapOptions;
  // Only trucks and drivers that can take over now: same type, documents valid, free; licence covers the truck.
  const trucks = (opts?.trucks ?? []).filter((t) => t.id !== x.truckId && t.matchesType && (t.status === 'READY' || t.status === 'EXPIRING'));
  const truck = trucks.find((t) => t.id === truckId);
  const swapDrivers = (opts?.drivers ?? []).filter((d) => d.status === 'FREE' && (!truck || licenceCovers(d.licenceClass, truck)));
  const driver = opts?.drivers.find((d) => d.id === driverId);
  const flagged = [truck?.status === 'BLOCKED' ? `${truck.number}: ${truck.note}` : '', driver?.status === 'BLOCKED' ? `${driver.name}: ${driver.note}` : ''].filter(Boolean).join('; ');
  const issue = c.code === 'COMPLIANCE_BLOCKED' ? c.error : flagged ? `Cannot swap without an override: ${flagged}.` : '';
  const showForm = canRun && ex && (!p?.label || ex.status === 'REJECTED' || changing);
  const canResume = canRun && ex && p?.label && ['OPEN', 'APPROVED'].includes(ex.status);

  const propose = () =>
    c.run(
      `/carrier/exceptions/${ex!.id}/proposal`,
      { fix, label, newEta: iso(eta), extraCost: cost || undefined, payer, swap: fix === 'SWAP' ? { truckId, driverId, override: issue && isOwner ? { reason } : undefined } : undefined },
      'Fix proposed.',
    ).then((ok) => ok && setChanging(false));

  const status =
    ex?.status === 'AWAITING_SHIPPER' ? 'Waiting for the shipper to approve the extra cost'
    : ex?.status === 'APPROVED' ? 'The shipper approved the fix'
    : ex?.status === 'REJECTED' ? `The shipper rejected the fix${ex.decisionReason ? `: “${ex.decisionReason}”` : ''}`
    : p?.label ? 'No approval needed (you carry the cost)' : 'Propose a fix';

  return (
    <Card className="border-[#E9B8B8] p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{ex ? `${ex.kind[0]}${ex.kind.slice(1).toLowerCase()}: ${p?.label ? 'fix proposed' : 'fix needed'}` : 'On hold'}</h2>
        <Chip tone="danger">On hold</Chip>
      </div>
      <p className="text-sm text-ink-muted">{ex?.description}</p>
      {p?.label && (
        <div className="mt-3 rounded-xl border-2 border-brand p-3 text-sm" data-testid="fix-proposal">
          <div className="font-bold">{p.label}{p.swap ? ` → ${p.swap.truckNumber} with ${p.swap.driverName}` : ''}</div>
          <div className="text-ink-muted">{p.newEta ? `New ETA ${dateTimeIST(p.newEta)}` : ''}{p.extraCost ? ` · extra cost ${rupees(p.extraCost)}, ${p.payer === 'SHIPPER' ? 'shipper pays' : 'you pay'}` : ''}</div>
          <div className="mt-1 font-semibold">{status}</div>
        </div>
      )}
      {c.error && !showForm && <p role="alert" className={`${errBox} mt-3`}>{c.error}</p>}
      {!canRun && <p className="mt-3 text-sm text-ink-muted">Only the owner or traffic manager can propose a fix.</p>}
      {canResume && !changing && (
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs"><TextField label="New ETA at drop" optional type="datetime-local" value={resumeEta} error={c.fields.newEta} onChange={(e) => setResumeEta(e.target.value)} /></div>
          <Button loading={c.busy} onClick={() => c.run(`/carrier/exceptions/${ex!.id}/resolve`, { newEta: iso(resumeEta) }, 'Back on the road.')}>{p?.fix === 'SWAP' ? 'Swap done: resume trip' : 'Fix done: resume trip'}</Button>
          <Button variant="secondary" onClick={() => setChanging(true)}>Change the proposal</Button>
        </div>
      )}
      {ex?.status === 'AWAITING_SHIPPER' && canRun && !changing && <div className="mt-3"><Button variant="secondary" onClick={() => setChanging(true)}>Change the proposal</Button></div>}
      {showForm && (
        <div className="mt-4 rounded-xl border border-line-faint p-4">
          <h3 className="mb-2 text-base font-bold">{ex?.status === 'REJECTED' ? 'Propose another fix' : 'Propose a fix'}</h3>
          {c.error && <p role="alert" className={errBox}>{c.error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField label="Fix" value={fix} error={c.fields.fix} onChange={(e) => setFix(e.target.value)}>
              <option value="SWAP">Swap the truck</option>
              <option value="WAIT">Wait</option>
              <option value="REPAIR">Repair on the spot</option>
              <option value="TRANSHIP">Tranship the goods</option>
            </SelectField>
            <TextField label="What will you do" required value={label} error={c.fields.label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Swap to a free truck from Hosur" />
            <TextField label="New ETA at drop" optional type="datetime-local" value={eta} error={c.fields.newEta} onChange={(e) => setEta(e.target.value)} />
            <TextField label="Extra cost (₹)" optional inputMode="decimal" value={cost} error={c.fields.extraCost} onChange={(e) => setCost(e.target.value)} />
            <SelectField label="Who pays" value={payer} error={c.fields.payer} onChange={(e) => setPayer(e.target.value)}>
              <option value="CARRIER">We pay</option>
              <option value="SHIPPER">The shipper pays (needs their approval)</option>
            </SelectField>
          </div>
          {fix === 'SWAP' && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SelectField label="Swap to truck" required value={truckId} error={c.fields['swap.truckId']} onChange={(e) => setTruckId(e.target.value)}>
                <option value="">{trucks.length ? 'Select a truck' : 'No truck of this type is ready'}</option>
                {trucks.map((t) => <option key={t.id} value={t.id}>{t.number} · {t.truckType}{t.status === 'EXPIRING' ? ` · ${t.note}` : ''}</option>)}
              </SelectField>
              <SelectField label="Driver" required value={driverId} error={c.fields['swap.driverId']} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">{swapDrivers.length ? 'Select a driver' : 'No free driver can drive this truck'}</option>
                {swapDrivers.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.licenceClass ?? 'no licence'}</option>)}
              </SelectField>
              <p className="text-xs text-ink-muted sm:col-span-2">The new truck and driver go through the same document and licence check as an assignment.</p>
            </div>
          )}
          {issue && (
            <div role="alert" className="mt-3 rounded-xl border border-[#E9B8B8] bg-tone-danger-bg p-3 text-sm text-[#7A1616]">
              <div className="font-semibold">{issue}</div>
              {isOwner ? (
                <div className="mt-2 max-w-md text-ink"><TextField label="Owner override: reason" required value={reason} error={c.fields['swap.override']} onChange={(e) => setReason(e.target.value)} /></div>
              ) : <p className="mt-1">Ask the owner to override, or pick another truck or driver.</p>}
            </div>
          )}
          <div className="mt-3 flex gap-3">
            <Button loading={c.busy} disabled={!!issue && (!isOwner || !reason.trim())} onClick={propose}>{issue ? 'Propose with owner override' : 'Propose fix'}</Button>
            {changing && <Button variant="ghost" onClick={() => setChanging(false)}>Cancel</Button>}
          </div>
        </div>
      )}
      <div className="mt-4"><h3 className="mb-2 text-sm font-bold">Events</h3><EventTimeline load={load} /></div>
    </Card>
  );
}

/** Claims the shipper raised: accept, or dispute with a reason. */
export function ClaimsList({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const canRun = useCanRun();
  const claims = load.execution?.claims ?? [];
  const c = useCall(onDone);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (!claims.length) return null;
  const tone = (s: string) => (s === 'RAISED' ? 'action' : s === 'ACCEPTED' ? 'billing' : s === 'DISPUTED' ? 'danger' : 'neutral') as 'action' | 'billing' | 'danger' | 'neutral';
  const label: Record<string, string> = { RAISED: 'Needs your answer', ACCEPTED: 'You accepted', DISPUTED: 'You disputed', WITHDRAWN: 'Withdrawn' };
  return (
    <div className="mt-4" data-testid="claims">
      <h3 className="mb-2 text-sm font-bold">Claims from the shipper</h3>
      {c.error && <p role="alert" className={errBox}>{c.error}</p>}
      <ul className="flex flex-col gap-3">
        {claims.map((cl) => (
          <li key={cl.id} className="rounded-xl border border-line-faint p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{cl.number} · {cl.kind === 'DAMAGE' ? 'Damage' : 'Shortage'} · {cl.qty} units · {rupees(cl.amount)}</div>
              <Chip tone={tone(cl.status)}>{label[cl.status] ?? cl.status}</Chip>
            </div>
            <p className="mt-1 text-ink-muted">{cl.description}{cl.carrierNote ? ` · your note: ${cl.carrierNote}` : ''}</p>
            {cl.status === 'RAISED' && canRun && (disputing === cl.id ? (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <div className="w-full max-w-sm"><TextField label="Why do you dispute it" required value={note} error={c.fields.note} onChange={(e) => setNote(e.target.value)} /></div>
                <Button variant="danger" loading={c.busy} onClick={() => c.run(`/carrier/claims/${cl.id}/respond`, { accept: false, note }, 'Claim disputed. The shipper reviews it.').then((ok) => ok && (setDisputing(null), setNote('')))}>Dispute claim</Button>
                <Button variant="ghost" onClick={() => setDisputing(null)}>Back</Button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-3">
                <Button loading={c.busy} onClick={() => c.run(`/carrier/claims/${cl.id}/respond`, { accept: true }, `Claim ${cl.number} accepted. It comes off the invoice.`)}>Accept {rupees(cl.amount)}</Button>
                <Button variant="secondary" onClick={() => setDisputing(cl.id)}>Dispute</Button>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Delivered: upload the signed POD; once it is with the shipper, show where it stands. */
export function DeliveredPanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const canRun = useCanRun();
  const x = load.execution!;
  const c = useCall(onDone);
  const [lr, setLr] = useState(x.pod?.lrNumber ?? '');
  const [photo, setPhoto] = useState('');
  const [remarks, setRemarks] = useState('');
  const uploaded = !!x.pod?.uploaded;
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">Delivered{x.deliveredAt ? ` · ${dateTimeIST(x.deliveredAt)}` : ''}</h2>
        <Chip tone="success">Delivered</Chip>
      </div>
      <p className="text-sm text-ink-muted">{x.goodQty ?? 0} received in good order{x.damagedQty ? `, ${x.damagedQty} damaged` : ''}{x.deliveryRemarks ? ` · ${x.deliveryRemarks}` : ''}.</p>
      {uploaded ? (
        <p className="mt-3 text-sm font-semibold" data-testid="pod-status">POD uploaded. {x.pod?.accepted ? 'The shipper accepted it.' : 'The shipper reviews it and accepts it by their rule.'}</p>
      ) : canRun ? (
        <div className="mt-4 rounded-xl border border-line-faint p-4">
          <h3 className="mb-2 text-base font-bold">Upload the signed POD</h3>
          {c.error && <p role="alert" className={errBox}>{c.error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TextField label="LR number on the signed copy" required value={lr} error={c.fields.lrNumber} onChange={(e) => setLr(e.target.value)} />
            <TextField label="Link to the photo" optional value={photo} error={c.fields.photoUrl} onChange={(e) => setPhoto(e.target.value)} placeholder="https://…" />
            <TextField label="Remarks on the copy" optional value={remarks} error={c.fields.remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
          <p className="mt-2 text-xs text-ink-muted">A clean POD whose LR number matches is accepted by the shipper’s rule at once. Remarks or damage send it to the shipper for review. Photo upload from the device arrives with file storage; for now paste a link.</p>
          <Button className="mt-3" loading={c.busy} onClick={() => c.run(`/carrier/loads/${load.id}/pod`, { lrNumber: lr, photoUrl: photo || undefined, remarks: remarks || undefined }, 'POD uploaded. The shipper can see it.')}>Upload POD</Button>
        </div>
      ) : <p className="mt-3 text-sm text-ink-muted">Waiting for the owner or traffic manager to upload the signed POD.</p>}
      <ClaimsList load={load} onDone={onDone} />
    </Card>
  );
}
