'use client';

import { useState } from 'react';
import { api, ApiError, API_URL, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { prettyPhone, rupees } from '@/lib/masters';
import { POD_RULE_LABEL, dateShort, dateTimeIST, type TripDetail } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Chip, type Tone } from '@/components/ui/Chip';
import { Card } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { ChoiceChips, fromRupeeInput, toRupeeInput } from '@/components/ui/Choice';
import { useToast } from '@/components/ui/Toast';

type Props = { trip: TripDetail; onChanged: () => void };

/** Runs a POST and reports the result; returns field errors for inline display. */
function useAction(onChanged: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, path: string, body: unknown, ok: { title: string; text?: string }) => {
    setBusy(key);
    try {
      await api(path, { method: 'POST', json: body });
      toast({ tone: 'success', ...ok });
      onChanged();
      return {} as Record<string, string>;
    } catch (err) {
      if (err instanceof ApiError && err.body.fields) return err.body.fields;
      toast({ tone: 'error', title: err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.' });
      onChanged();
      return {};
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

const lr = (t: TripDetail) => t.documents.find((d) => d.kind === 'LR');
const ewb = (t: TripDetail) => t.documents.find((d) => d.kind === 'EWAY_BILL');

/** Opens the printable LR in a new tab (the API needs the session token, so a plain link will not do). */
export async function openLr(tripId: string) {
  const win = window.open('', '_blank');
  try {
    const token = tokenStore.get();
    const res = await fetch(`${API_URL}/trips/${tripId}/lr`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('LR not available');
    const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
    if (win) win.location.href = url;
    else window.open(url, '_blank');
  } catch {
    win?.close();
    alert('The LR could not be opened. Please try again.');
  }
}

/** Ready for pickup: the shipper can view and print the LR the carrier issued. */
function LrActions({ trip }: Props) {
  if (!lr(trip)) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2.5">
      <Button variant="secondary" onClick={() => openLr(trip.id)}>View / print LR</Button>
    </div>
  );
}

export function ReadyPanel({ trip, onChanged }: Props) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Truck confirmed · reporting for pickup</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-ink-muted">Truck</dt><dd className="font-semibold">{trip.truck?.number}</dd></div>
        <div><dt className="text-xs text-ink-muted">Driver</dt><dd className="font-semibold">{trip.truck?.driverName} · {prettyPhone(trip.truck?.driverPhone)}</dd></div>
        <div><dt className="text-xs text-ink-muted">LR</dt><dd className="font-semibold">{lr(trip)?.number ?? '—'}</dd></div>
        <div><dt className="text-xs text-ink-muted">E-way bill</dt><dd className="font-semibold">{ewb(trip)?.number ?? '—'}</dd>{ewb(trip)?.validUntil && <dd className="text-xs text-ink-muted">Valid to {dateTimeIST(ewb(trip)!.validUntil!)}</dd>}</div>
      </dl>
      <LrActions trip={trip} onChanged={onChanged} />
      <p className="mt-3 text-sm text-ink-muted">Reached pickup and Loaded come in from the carrier; this page updates by itself.</p>
    </Card>
  );
}

export function TransitPanel({ trip }: Props) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-lg font-semibold">On the road</h2>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-ink-muted">ETA at drop</dt><dd className="text-lg font-bold">{trip.eta ? dateTimeIST(trip.eta) : 'Not shared yet'}</dd></div>
        <div><dt className="text-xs text-ink-muted">Last update</dt><dd className="font-semibold">{trip.lastLocation ?? 'Loaded'}</dd>{trip.lastUpdateAt && <dd className="text-xs text-ink-muted">{dateTimeIST(trip.lastUpdateAt)}</dd>}</div>
        <div><dt className="text-xs text-ink-muted">Truck</dt><dd className="font-semibold">{trip.truck?.number}</dd></div>
        <div><dt className="text-xs text-ink-muted">Driver</dt><dd className="font-semibold">{trip.truck?.driverName} · {prettyPhone(trip.truck?.driverPhone)}</dd></div>
      </dl>
    </Card>
  );
}

/** Delivered: wait for the POD photo, or review a POD that shows a problem and raise a claim. */
export function PodReviewPanel({ trip, onChanged }: Props) {
  const { busy, run } = useAction(onChanged);
  const d = trip.delivery;
  const pod = trip.documents.find((x) => x.kind === 'POD');
  const remarks = trip.activity.find((a) => a.action === 'POD_RECEIVED')?.text;
  const open = trip.claims.filter((c) => c.status === 'RAISED');
  const [form, setForm] = useState({ kind: 'DAMAGE', qty: String(d?.damagedQty || ''), unitValue: '', description: d?.remarks ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const amount = (Number(form.qty) || 0) * (fromRupeeInput(form.unitValue) ?? 0);

  if (!pod) {
    return (
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Delivered · waiting for the POD photo</h2>
        <p className="mt-1.5 text-sm text-ink-muted">Receiver confirmed {d?.goodQty} received in good order{d?.damagedQty ? `, ${d.damagedQty} damaged` : ''}. The driver has been asked for a photo of the signed LR.</p>
      </Card>
    );
  }

  const raise = async () => {
    setErrors(await run('claim', `/trips/${trip.id}/claims`, { ...form, unitValue: fromRupeeInput(form.unitValue) }, { title: 'Claim raised.', text: 'The carrier is asked to accept or dispute it.' }));
  };

  return (
    <Card className="border-[#E9C9A0] p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <h2 className="text-lg font-semibold">Delivered · POD needs a look</h2>
        <Chip tone="action">Your decision</Chip>
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">
        Receiver confirmed {d?.goodQty} good{d?.damagedQty ? `, ${d.damagedQty} damaged` : ''}. {remarks}
      </p>
      <div className="mt-4 flex flex-wrap items-start gap-4">
        {pod.fileUrl ? (
          <a href={pod.fileUrl} target="_blank" rel="noreferrer" className="flex h-[200px] w-[160px] items-center justify-center rounded-btn border border-dashed border-[#A7B4B0] bg-[#EEF2F1] text-center text-xs text-ink-muted underline">Open signed LR photo</a>
        ) : (
          <div className="flex h-[200px] w-[160px] items-center justify-center rounded-btn border border-dashed border-[#A7B4B0] bg-[#EEF2F1] p-3 text-center text-xs text-ink-muted">Signed LR photo (LR {pod.number})</div>
        )}
        <div className="flex min-w-[260px] flex-1 flex-col gap-3">
          {open.map((c) => (
            <p key={c.id} className="rounded-xl bg-tone-progress-bg px-3.5 py-2.5 text-sm text-[#0B3F60]">Claim {c.number} raised for {rupees(c.amount)}. It stays open while you accept the POD.</p>
          ))}
          {open.length === 0 && (
            <div className="flex flex-col gap-3 rounded-xl bg-brand-soft p-4">
              <ChoiceChips label="Claim for" options={[{ value: 'DAMAGE', label: 'Damage' }, { value: 'SHORTAGE', label: 'Shortage' }]} value={form.kind} onChange={(v) => setForm({ ...form, kind: v })} />
              <div className="grid grid-cols-2 gap-3">
                <TextField label="Units" required inputMode="numeric" value={form.qty} onChange={(e) => { setForm({ ...form, qty: e.target.value.replace(/\D/g, '') }); setErrors({ ...errors, qty: '' }); }} error={errors.qty} />
                <TextField label="Value of one unit (₹)" required inputMode="numeric" value={form.unitValue} onChange={(e) => { setForm({ ...form, unitValue: toRupeeInput(e.target.value) }); setErrors({ ...errors, unitValue: '' }); }} error={errors.unitValue} help="From your invoice to the buyer." />
              </div>
              <TextField label="What is wrong" required value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); setErrors({ ...errors, description: '' }); }} error={errors.description} />
              <Button className="self-start" onClick={raise} loading={busy === 'claim'}>Raise claim {amount > 0 ? rupees(amount) : ''}</Button>
            </div>
          )}
          <Button variant="secondary" className="self-start" loading={busy === 'accept'} onClick={() => run('accept', `/trips/${trip.id}/pod/accept`, {}, { title: 'POD accepted.', text: 'The carrier can now invoice this trip.' })}>
            {open.length ? 'Accept POD' : 'Accept POD, no claim'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

const CLAIM_TONE: Record<string, Tone> = { RAISED: 'action', ACCEPTED: 'success', DISPUTED: 'danger', WITHDRAWN: 'neutral' };
const CLAIM_LABEL: Record<string, string> = { RAISED: 'Waiting for carrier', ACCEPTED: 'Accepted by carrier', DISPUTED: 'Disputed', WITHDRAWN: 'Withdrawn' };

export function ClaimsCard({ trip, onChanged }: Props) {
  const { busy, run } = useAction(onChanged);
  if (!trip.claims.length) return null;
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-base font-semibold">Claims</h2>
      <div className="flex flex-col gap-2.5 text-sm">
        {trip.claims.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-faint pb-2.5 last:border-0">
            <div>
              <div className="font-semibold">{c.number} · {c.qty} × {rupees(c.unitValue)} = {rupees(c.amount)}</div>
              <div className="text-[13px] text-ink-muted">{c.description}{c.carrierNote ? ` · Carrier: “${c.carrierNote}”` : ''}</div>
            </div>
            <div className="flex items-center gap-2">
              <Chip tone={CLAIM_TONE[c.status]}>{CLAIM_LABEL[c.status]}</Chip>
              {(c.status === 'RAISED' || c.status === 'DISPUTED') && !['INVOICED', 'CLOSED'].includes(trip.status) && (
                <Button size="sm" variant="ghost" loading={busy === c.id} onClick={() => run(c.id, `/trips/${trip.id}/claims/${c.id}/withdraw`, {}, { title: `Claim ${c.number} withdrawn.` })}>Withdraw</Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PodAcceptedPanel({ trip, onChanged }: Props) {
  const { busy, run } = useAction(onChanged);
  const needsHard = trip.pod.rule !== 'DIGITAL' && !trip.pod.hardCopy;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">POD accepted</h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Your rule: {POD_RULE_LABEL[trip.pod.rule]}.{' '}
        {trip.pod.readyToBill ? 'The carrier can invoice now; you will see it here and in Approvals.' : 'The carrier can invoice once the original LR reaches you.'}
      </p>
      {needsHard && (
        <Button className="mt-3.5" variant="secondary" loading={busy === 'hard'} onClick={() => run('hard', `/trips/${trip.id}/pod/hard-copy`, {}, { title: 'Hard copy marked as received.' })}>
          Mark hard copy received
        </Button>
      )}
    </Card>
  );
}

/** Invoice: lines with the billing agent's checks; approve, query, pay. */
export function InvoicePanel({ trip, onChanged }: Props) {
  const { user } = useAuth();
  const { busy, run } = useAction(onChanged);
  const inv = trip.invoice!;
  const [querying, setQuerying] = useState(false);
  const [reason, setReason] = useState('');
  const [pay, setPay] = useState({ mode: 'UPI', reference: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const limit = user?.approvalLimit ?? null;
  const blocked = limit == null ? "Your role can't approve or record payments." : inv.total > limit ? `${rupees(inv.total)} is above your approval limit of ${rupees(limit)}.` : '';
  const needsHard = trip.pod.rule !== 'DIGITAL' && !trip.pod.hardCopy;
  const failed = inv.checks.filter((c) => !c.ok);

  const statusChip = { RECEIVED: <Chip tone="action">Waiting for approval</Chip>, APPROVED: <Chip tone="billing">Approved · due {dateShort(inv.dueDate)}</Chip>, PAID: <Chip tone="success">Paid</Chip>, QUERIED: <Chip tone="danger">Queried</Chip> }[inv.status];

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Invoice {inv.number} · {rupees(inv.total)}</h2>
          <p className="mt-1 text-sm text-ink-muted">From {trip.carrier} · received {dateTimeIST(inv.receivedAt)} · due {dateShort(inv.dueDate)}</p>
        </div>
        {statusChip}
      </div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm" aria-label="Invoice lines">
          <tbody>
            <tr><td className="border-b border-line-faint px-3.5 py-2.5">Freight</td><td className="tabular border-b border-line-faint px-3.5 py-2.5 text-right">{rupees(inv.freight)}</td></tr>
            <tr><td className="border-b border-line-faint px-3.5 py-2.5">Detention</td><td className="tabular border-b border-line-faint px-3.5 py-2.5 text-right">{rupees(inv.detention)}</td></tr>
            <tr><td className="border-b border-line-faint px-3.5 py-2.5">Claims deducted</td><td className="tabular border-b border-line-faint px-3.5 py-2.5 text-right">{inv.claimDeduction ? `− ${rupees(inv.claimDeduction)}` : rupees(0)}</td></tr>
            <tr><td className="px-3.5 py-2.5 font-bold">Total payable</td><td className="tabular px-3.5 py-2.5 text-right font-bold">{rupees(inv.total)}</td></tr>
          </tbody>
        </table>
      </div>
      <ul aria-label="Checks" className="mt-3.5 flex flex-wrap gap-2">
        {inv.checks.map((c) => (
          <li key={c.label}><Chip tone={c.ok ? 'success' : 'danger'}>{c.label}: {c.detail}</Chip></li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-ink-muted">GST shown on the carrier&apos;s PDF; the rate and charge type are to be confirmed with accounts.</p>

      {inv.status === 'QUERIED' && <p className="mt-4 rounded-xl bg-tone-danger-bg px-4 py-3 text-sm text-[#7A1616]">You queried this invoice: “{inv.queryReason}”. Waiting for a corrected invoice from {trip.carrier}.</p>}

      {inv.status === 'RECEIVED' && (
        <>
          {failed.length > 0 && <p className="mt-4 rounded-xl bg-tone-action-bg px-4 py-3 text-sm text-[#6B2E08]"><strong>Check before approving:</strong> {failed.map((c) => `${c.label.toLowerCase()} — ${c.detail}`).join('; ')}.</p>}
          {blocked && <p className="mt-3 rounded-xl bg-tone-progress-bg px-4 py-3 text-sm text-[#0B3F60]">{blocked} {inv.aboveThreshold ? 'It is in Approvals for someone who can.' : ''}</p>}
          <div className="mt-4 flex flex-wrap gap-2.5">
            <Button disabled={!!blocked} loading={busy === 'approve'} onClick={() => run('approve', `/trips/${trip.id}/invoice/approve`, {}, { title: `Invoice ${inv.number} approved.`, text: 'Record the payment when it is done.' })}>
              Approve {rupees(inv.total)}
            </Button>
            {!querying && <Button variant="secondary" onClick={() => setQuerying(true)}>Query invoice</Button>}
          </div>
        </>
      )}

      {inv.status === 'APPROVED' && (
        needsHard ? (
          <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-xl bg-tone-action-bg px-4 py-3 text-sm text-[#6B2E08]">
            <span>Your POD rule needs the original LR before payment.</span>
            <Button size="sm" variant="secondary" loading={busy === 'hard'} onClick={() => run('hard', `/trips/${trip.id}/pod/hard-copy`, {}, { title: 'Hard copy marked as received.' })}>Mark hard copy received</Button>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3 rounded-xl bg-brand-soft p-4">
            <p className="text-sm">Pay {trip.carrier} by UPI or bank transfer, then record it here. The trip closes and the payment is ready for Tally.</p>
            <ChoiceChips label="Paid by" options={[{ value: 'UPI', label: 'UPI' }, { value: 'BANK', label: 'Bank transfer' }]} value={pay.mode} onChange={(v) => setPay({ ...pay, mode: v })} />
            <div className="max-w-[320px]">
              <TextField label={pay.mode === 'UPI' ? 'UPI reference' : 'Bank (UTR) reference'} required value={pay.reference} onChange={(e) => { setPay({ ...pay, reference: e.target.value }); setErrors({}); }} error={errors.reference} />
            </div>
            {blocked && <p className="text-sm text-[#0B3F60]">{blocked}</p>}
            <div className="flex flex-wrap gap-2.5">
              <Button disabled={!!blocked} loading={busy === 'pay'} onClick={async () => setErrors(await run('pay', `/trips/${trip.id}/invoice/pay`, pay, { title: `Payment of ${rupees(inv.total)} recorded.`, text: 'Trip closed.' }))}>
                Record payment {rupees(inv.total)}
              </Button>
              {!querying && <Button variant="secondary" onClick={() => setQuerying(true)}>Query invoice</Button>}
            </div>
          </div>
        )
      )}

      {querying && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl bg-brand-soft p-4">
          <TextField label="What is wrong with the invoice" required value={reason} onChange={(e) => { setReason(e.target.value); setErrors({}); }} error={errors.reason} placeholder="e.g. Detention not agreed" />
          <div className="flex gap-2">
            <Button size="sm" variant="danger" loading={busy === 'query'} onClick={async () => { const f = await run('query', `/trips/${trip.id}/invoice/query`, { reason }, { title: `Invoice ${inv.number} queried.`, text: 'The carrier is asked for a corrected invoice.' }); setErrors(f); if (!Object.keys(f).length) setQuerying(false); }}>
              Send query
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setQuerying(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {inv.status === 'PAID' && (
        <p className="mt-4 rounded-xl bg-tone-success-bg px-4 py-3 text-sm text-[#14532D]">
          Paid {inv.paidAt ? dateTimeIST(inv.paidAt) : ''} by {inv.paymentMode === 'UPI' ? 'UPI' : 'bank transfer'}, reference {inv.paymentRef}. Trip closed.
        </p>
      )}
    </Card>
  );
}

export function DocumentsCard({ trip }: { trip: TripDetail }) {
  const rows: { label: string; doc?: TripDetail['documents'][number]; pending: string }[] = [
    { label: 'LR', doc: lr(trip), pending: 'After truck is confirmed' },
    { label: 'E-way bill', doc: ewb(trip), pending: 'After truck is confirmed' },
    { label: 'POD photo', doc: trip.documents.find((d) => d.kind === 'POD'), pending: 'After delivery' },
  ];
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-base font-semibold">Documents</h2>
      <div className="flex flex-col text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2 border-b border-line-faint py-2 last:border-0">
            <span>{r.label}{r.doc?.number ? ` ${r.doc.number}` : ''}</span>
            {r.doc ? (
              <Chip tone="success">{r.doc.validUntil ? `Valid to ${dateShort(r.doc.validUntil)}` : r.label === 'POD photo' ? (trip.pod.accepted ? 'Accepted' : 'Received') : 'Issued'}</Chip>
            ) : (
              <Chip tone="neutral">{r.pending}</Chip>
            )}
          </div>
        ))}
        {trip.pod.rule !== 'DIGITAL' && trip.pod.accepted && (
          <div className="flex items-center justify-between gap-2 py-2"><span>POD hard copy</span><Chip tone={trip.pod.hardCopy ? 'success' : 'action'}>{trip.pod.hardCopy ? 'Received' : 'Waiting'}</Chip></div>
        )}
      </div>
    </Card>
  );
}
