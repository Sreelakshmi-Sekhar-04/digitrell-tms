'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { rupees } from '@/lib/masters';
import { CANCEL_REASONS, dateTimeIST, timeIST, type TripDetail } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card } from '@/components/ui/Card';
import { Dialog } from '@/components/ui/Dialog';
import { Drawer } from '@/components/ui/Drawer';
import { SelectField, TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

type Props = { trip: TripDetail; onChanged: () => void };
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function post(path: string, json: unknown, method = 'POST') {
  try {
    await api(path, { method, json });
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, fields: err instanceof ApiError ? err.body.fields ?? {} : {}, message: err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.' };
  }
}

// ---------- header actions: edit and cancel ----------

function EditBookingDrawer({ trip, open, onClose, onChanged }: Props & { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const initial = {
    pickupDate: trip.pickupDate ?? '', weightTonnes: trip.weightTonnes != null ? String(trip.weightTonnes) : '', material: trip.material ?? '',
    receiverContact: trip.receiverContact ?? '', reference: trip.reference ?? '', notes: trip.notes ?? '',
  };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const dateChanged = form.pickupDate !== initial.pickupDate;
  const loadChanged = form.pickupDate !== initial.pickupDate || form.weightTonnes !== initial.weightTonnes || form.material !== initial.material;
  const set = (k: keyof typeof form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = { receiverContact: form.receiverContact || null, reference: form.reference || null, notes: form.notes || null };
    if (trip.edit.load) Object.assign(body, { pickupDate: form.pickupDate, weightTonnes: form.weightTonnes, material: form.material });
    const r = await post(`/trips/${trip.id}`, body, 'PATCH');
    setBusy(false);
    if (!r.ok) {
      setErrors(r.fields);
      setFormError(r.message);
      return;
    }
    toast({ tone: 'success', title: 'Booking updated.', text: dateChanged && trip.edit.requotes ? 'Offers restart from the lowest contract rate for the new date.' : undefined });
    onClose();
    onChanged();
  };

  return (
    <Drawer open={open} title={`Edit ${trip.number}`} subtitle="Pickup, drop and truck type can't change; cancel and rebook for that." dirty={JSON.stringify(form) !== JSON.stringify(initial)} onClose={onClose} onSubmit={save} footer={<Button type="submit" loading={busy}>Save changes</Button>}>
      {formError && <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
      {!trip.edit.load && <p className="rounded-xl bg-tone-progress-bg px-4 py-3 text-sm text-[#0B3F60]">Date, weight and material are fixed once a carrier is awarded.</p>}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <TextField label="Pickup date" type="date" min={istToday()} disabled={!trip.edit.load} value={form.pickupDate} onChange={(e) => set('pickupDate', e.target.value)} error={errors.pickupDate} />
        <TextField label="Weight (tonnes)" inputMode="decimal" disabled={!trip.edit.load} value={form.weightTonnes} onChange={(e) => set('weightTonnes', e.target.value.replace(/[^\d.,]/g, ''))} error={errors.weightTonnes} />
      </div>
      <TextField label="Material" disabled={!trip.edit.load} value={form.material} onChange={(e) => set('material', e.target.value)} error={errors.material} />
      {dateChanged && trip.edit.requotes && (
        <p role="status" className="rounded-xl bg-tone-action-bg px-4 py-3 text-sm text-[#6B2E08]">Changing the pickup date restarts the offers from the lowest contract rate valid on the new date. Offers made so far are cleared. If no carrier has a contract rate for that date, the change is refused.</p>
      )}
      <TextField label="Receiver contact" optional value={form.receiverContact} onChange={(e) => set('receiverContact', e.target.value)} error={errors.receiverContact} />
      <TextField label="Your reference" optional value={form.reference} onChange={(e) => set('reference', e.target.value)} error={errors.reference} />
      <TextField label="Notes for carrier" optional value={form.notes} onChange={(e) => set('notes', e.target.value)} error={errors.notes} />
    </Drawer>
  );
}

function CancelDialog({ trip, open, onClose, onChanged }: Props & { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const r = await post(`/trips/${trip.id}/cancel`, { reason, note: note || null });
    setBusy(false);
    if (!r.ok) {
      setErrors(Object.keys(r.fields).length ? r.fields : { reason: r.message });
      return;
    }
    toast({ tone: 'success', title: `${trip.number} cancelled.`, text: 'Everyone involved is told.' });
    onClose();
    onChanged();
  };
  return (
    <Dialog
      open={open}
      title={`Cancel ${trip.number}, ${trip.origin} → ${trip.destination}?`}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} data-autofocus>Keep booking</Button>
          <Button className="!border-transparent !bg-tone-danger !text-white hover:!bg-[#7A1616]" onClick={submit} loading={busy}>Cancel booking</Button>
        </>
      }
    >
      <ul className="list-disc pl-5 text-sm leading-relaxed">
        {trip.cancel.consequences.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <SelectField label="Reason" required value={reason} onChange={(e) => { setReason(e.target.value); setErrors({}); }} error={errors.reason}>
        <option value="">Choose a reason</option>
        {CANCEL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
      </SelectField>
      <TextField label="Note" optional={reason !== 'OTHER'} required={reason === 'OTHER'} value={note} onChange={(e) => { setNote(e.target.value); setErrors({}); }} error={errors.note} placeholder="Seen by carriers and in the log" />
    </Dialog>
  );
}

export function TripActions({ trip, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  if (!trip.edit.extras && !trip.cancel.allowed && !trip.cancel.roleOnly) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {trip.edit.extras && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit booking</Button>}
      {(trip.cancel.allowed || trip.cancel.roleOnly) && (
        <Button size="sm" variant="danger" disabled={!trip.cancel.allowed} title={trip.cancel.reason ?? undefined} onClick={() => setCancelling(true)}>Cancel booking</Button>
      )}
      {editing && <EditBookingDrawer trip={trip} open onClose={() => setEditing(false)} onChanged={onChanged} />}
      {cancelling && <CancelDialog trip={trip} open onClose={() => setCancelling(false)} onChanged={onChanged} />}
    </div>
  );
}

// ---------- give the offered carrier more time ----------

export function ExtendOffer({ trip, onChanged }: Props) {
  const toast = useToast();
  const [hours, setHours] = useState('2');
  const [busy, setBusy] = useState(false);
  if (!trip.quotes.some((q) => q.status === 'REQUESTED')) return null;

  const extend = async () => {
    setBusy(true);
    const r = await post(`/trips/${trip.id}/extend`, { hours: Number(hours) });
    setBusy(false);
    if (r.ok) toast({ tone: 'success', title: `The carrier has ${hours} more hour${hours === '1' ? '' : 's'} to answer.` });
    else toast({ tone: 'error', title: r.message });
    onChanged();
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-faint pt-4">
      <label htmlFor="extend-hours" className="text-sm font-semibold">Give the carrier more time</label>
      <select id="extend-hours" value={hours} onChange={(e) => setHours(e.target.value)} className="min-h-[36px] rounded-lg border border-line-strong bg-white px-2 text-[13px]">
        {['1', '2', '4', '8', '24'].map((h) => <option key={h} value={h}>+{h} h</option>)}
      </select>
      <Button size="sm" variant="secondary" onClick={extend} loading={busy}>Extend response time</Button>
    </div>
  );
}

// ---------- on hold and cancelled ----------

export function OnHoldPanel({ trip, onChanged }: Props) {
  const { user } = useAuth();
  const toast = useToast();
  const ex = trip.exception;
  const p = ex?.proposal ?? null;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const limit = user?.approvalLimit ?? null;
  const blocked = p && (limit == null ? "Your role can't approve extra costs." : p.extraCost > limit ? `${rupees(p.extraCost)} is above your approval limit of ${rupees(limit)}.` : '');

  const decide = async (approve: boolean) => {
    setBusy(approve ? 'approve' : 'reject');
    const r = await post(`/trips/${trip.id}/exception/${approve ? 'approve' : 'reject'}`, approve ? {} : { reason });
    setBusy(null);
    if (!r.ok) {
      if (r.fields.reason) setError(r.fields.reason);
      else toast({ tone: 'error', title: r.message });
      return;
    }
    toast({ tone: 'success', title: approve ? 'Fix approved.' : 'Fix rejected.', text: approve ? 'The carrier goes ahead; you get the new ETA.' : 'The carrier is asked for another option.' });
    window.dispatchEvent(new Event('dtms:approvals-changed'));
    onChanged();
  };

  return (
    <Card className="border-[#E9B8B8] p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-semibold">{ex ? `${ex.kind[0]}${ex.kind.slice(1).toLowerCase()} reported` : 'On hold'}</h2>
        <Chip tone="danger">On hold</Chip>
      </div>
      {ex && <p className="mt-1.5 text-sm text-ink-muted">{ex.description} · reported {dateTimeIST(ex.at)}</p>}
      {p ? (
        <div className="mt-4 rounded-xl border-2 border-brand p-3.5">
          <div className="font-bold">Proposed fix: {p.label}</div>
          <div className="mt-1 text-[13px] text-ink-muted">
            {p.newEta ? `New ETA ${dateTimeIST(p.newEta)} · ` : ''}
            {p.extraCost ? `extra ${rupees(p.extraCost)}, ${p.payer === 'SHIPPER' ? 'billed to you' : 'carrier pays'}` : 'no extra cost'}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">The exception agent is working out options with the carrier.</p>
      )}

      {ex?.status === 'AWAITING_SHIPPER' && (
        <>
          {blocked && <p className="mt-3 rounded-xl bg-tone-progress-bg px-4 py-3 text-sm text-[#0B3F60]">{blocked} It is in Approvals for someone who can.</p>}
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button disabled={!!blocked} loading={busy === 'approve'} onClick={() => decide(true)}>Approve fix · {rupees(p?.extraCost)}</Button>
            {!rejecting && <Button variant="secondary" onClick={() => setRejecting(true)} disabled={limit == null}>Reject fix</Button>}
          </div>
          {rejecting && (
            <div className="mt-3 flex flex-col gap-3 rounded-xl bg-brand-soft p-4">
              <TextField label="Why" required value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} error={error} placeholder="e.g. Carrier should bear this cost" />
              <div className="flex gap-2">
                <Button size="sm" variant="danger" loading={busy === 'reject'} onClick={() => decide(false)}>Reject fix</Button>
                <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </>
      )}
      {ex?.status === 'REJECTED' && <p className="mt-3 text-sm">You rejected this fix: “{ex.decisionReason}”. Waiting for another option from the carrier.</p>}
      {ex?.status === 'APPROVED' && <p className="mt-3 text-sm">You approved this fix. The carrier is carrying it out; the trip moves back on the road when done.</p>}
      {ex?.status === 'OPEN' && p && <p className="mt-3 text-sm">The carrier is handling this at their cost. Nothing is needed from you.</p>}
    </Card>
  );
}

export function CancelledPanel({ trip }: { trip: TripDetail }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Cancelled</h2>
      <p className="mt-1.5 text-sm text-ink-muted">{trip.cancelled ? `${dateTimeIST(trip.cancelled.at)} · ${trip.cancelled.reason}` : ''}</p>
    </Card>
  );
}

/** Latest delay notice, shown on the road panel. */
export function DelayNote({ trip }: { trip: TripDetail }) {
  const d = trip.delays[0];
  if (!d) return null;
  return <p className="mt-3 rounded-xl bg-tone-action-bg px-4 py-2.5 text-sm text-[#6B2E08]">Delay reported {timeIST(d.at)}: {d.description}. ETA updated.</p>;
}
