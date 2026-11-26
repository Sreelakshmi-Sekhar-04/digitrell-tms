'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { STAGES, dateShort, dateTimeIST, stageOf, timeIST, tonnes, type QuoteRow, type TripDetail } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Chip, TripStatusChip, type Tone } from '@/components/ui/Chip';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ClaimsCard, DocumentsCard, InvoicePanel, PodAcceptedPanel, PodReviewPanel, ReadyPanel, TransitPanel } from '@/components/trips/ExecutionPanels';
import { CancelledPanel, DelayNote, OnHoldPanel, TripActions, WidenRequest } from '@/components/trips/ExceptionPanels';

const QUOTE_CHIP: Record<QuoteRow['status'], { label: string; tone: Tone }> = {
  REQUESTED: { label: 'Waiting', tone: 'neutral' },
  QUOTED: { label: 'Quoted', tone: 'success' },
  DECLINED: { label: 'Passed', tone: 'neutral' },
  AWARDED: { label: 'Awarded', tone: 'progress' },
  LOST: { label: 'Not chosen', tone: 'neutral' },
  WITHDRAWN: { label: 'Request closed', tone: 'neutral' },
};

function Stepper({ status }: { status: string }) {
  const current = stageOf(status);
  return (
    <Card className="overflow-x-auto px-5 py-4">
      <ol aria-label="Trip progress" className="grid min-w-[720px] grid-cols-7 gap-2">
        {STAGES.map((label, i) => {
          const done = i < current;
          const cur = i === current;
          return (
            <li key={label} aria-current={cur ? 'step' : undefined} className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <span className={`h-3.5 w-3.5 flex-none rounded-full ${done ? 'bg-brand' : cur ? 'border-[3px] border-brand bg-white' : 'border-2 border-[#A7B4B0] bg-white'}`} />
                {i < STAGES.length - 1 && <span className={`h-0.5 flex-1 ${done ? 'bg-brand' : 'bg-[#D5DDDA]'}`} />}
              </div>
              <span className={`text-[13px] ${cur ? 'font-bold text-ink' : done ? 'text-ink-soft' : 'text-ink-muted'}`}>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** Reject all quotes and ask the same carriers again. Reason required (it is logged). */
function RetenderForm({ tripId, label, onDone, onCancel }: { tripId: string; label: string; onDone: () => void; onCancel?: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!reason.trim()) return setError('Say why, e.g. "All quotes above budget". It is logged and kept with the trip.');
    setBusy(true);
    try {
      await api(`/trips/${tripId}/retender`, { method: 'POST', json: { reason } });
      toast({ tone: 'success', title: 'Quotes requested again.', text: 'The same approved carriers have a new deadline.' });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.fields?.reason ?? err.body.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl bg-brand-soft p-4">
      <TextField label="Reason" required value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} error={error} placeholder="e.g. All quotes above budget" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={submit} loading={busy}>{label}</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}

function ComparePanel({ trip, onChanged }: { trip: TripDetail; onChanged: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const quoted = trip.quotes.filter((q) => q.status === 'QUOTED').sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  const others = trip.quotes.filter((q) => q.status !== 'QUOTED');
  const [picked, setPicked] = useState(trip.recommendation?.quoteId ?? quoted[0]?.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const choice = quoted.find((q) => q.id === picked) ?? quoted[0];
  const waiting = trip.quotes.filter((q) => q.status === 'REQUESTED');
  const limit = user?.approvalLimit ?? null;
  const blocked = limit == null ? "Your role can't approve awards. Your logistics head or an approver will see it in Approvals." : choice?.amount != null && choice.amount > limit ? `${rupees(choice.amount)} is above your approval limit of ${rupees(limit)}. Ask your logistics head to approve it.` : '';

  const award = async () => {
    if (!choice) return;
    setBusy(true);
    setError('');
    try {
      await api(`/trips/${trip.id}/award`, { method: 'POST', json: { quoteId: choice.id } });
      toast({ tone: 'success', title: `Awarded to ${choice.carrier}.`, text: 'Truck and driver details will follow. You can undo for 10 minutes.' });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3.5 flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Choose a carrier</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {quoted.length} of {trip.quotes.length} carriers quoted.{trip.budget != null && ` Budget for this lane: ${rupees(trip.budget)}.`}
            {waiting.length > 0 && !trip.quotesClosedAt && trip.quoteDeadline && ` ${waiting.map((w) => w.carrier).join(', ')} can still reply until ${timeIST(trip.quoteDeadline)}.`}
          </p>
        </div>
        <Chip tone="action">Your decision</Chip>
      </div>
      <div className="hidden overflow-x-auto rounded-xl border border-line sm:block">
        <table className="w-full border-collapse text-sm" aria-label="Quotes">
          <thead>
            <tr>
              {['Pick', 'Carrier', 'Quote', 'vs budget', 'On time', 'POD speed', 'Accepts', 'Score'].map((h) => (
                <th key={h} scope="col" className={`whitespace-nowrap border-b border-line bg-[#FAFBFB] px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted ${h === 'Quote' ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quoted.map((q) => {
              const on = q.id === choice?.id;
              return (
                <tr key={q.id} onClick={() => setPicked(q.id)} className={`cursor-pointer ${on ? 'bg-[#F0F8F8]' : 'hover:bg-[#F4F9F9]'}`}>
                  <td className="border-b border-line-faint px-3.5 py-3">
                    <input type="radio" name="award" checked={on} onChange={() => setPicked(q.id)} aria-label={`Pick ${q.carrier}`} className="h-[18px] w-[18px] accent-brand" />
                  </td>
                  <td className="border-b border-line-faint px-3.5 py-3">
                    <div className="font-semibold">{q.carrier}</div>
                    {q.rank === 1 && <div className="mt-0.5 text-xs font-semibold text-brand-dark">Recommended</div>}
                    {q.trips === 0 && <div className="mt-0.5 text-xs text-ink-muted">No track record yet</div>}
                  </td>
                  <td className="tabular border-b border-line-faint px-3.5 py-3 text-right font-bold">{rupees(q.amount)}</td>
                  <td className={`border-b border-line-faint px-3.5 py-3 ${q.overBudget ? 'font-semibold text-tone-danger' : 'text-tone-success'}`}>
                    {q.vsBudget == null ? '—' : q.vsBudget <= 0 ? `${rupees(-q.vsBudget)} under` : `${rupees(q.vsBudget)} over`}
                  </td>
                  <td className="border-b border-line-faint px-3.5 py-3">{q.onTimePct != null ? `${q.onTimePct}%` : '—'}</td>
                  <td className="border-b border-line-faint px-3.5 py-3">{q.podDays != null ? `${q.podDays} days` : '—'}</td>
                  <td className="border-b border-line-faint px-3.5 py-3">{q.acceptPct != null ? `${q.acceptPct}%` : '—'}</td>
                  <td className="border-b border-line-faint px-3.5 py-3 font-semibold">{q.score}</td>
                </tr>
              );
            })}
            {others.map((q) => (
              <tr key={q.id} className="text-ink-muted">
                <td className="border-b border-line-faint px-3.5 py-3" />
                <td className="border-b border-line-faint px-3.5 py-3 font-semibold">{q.carrier}</td>
                <td className="border-b border-line-faint px-3.5 py-3 text-right" colSpan={1}><Chip tone={QUOTE_CHIP[q.status].tone}>{QUOTE_CHIP[q.status].label}</Chip></td>
                <td className="border-b border-line-faint px-3.5 py-3" colSpan={5} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones: one card per quote instead of a sideways-scrolling table (approved design, phone layout). */}
      <fieldset className="flex flex-col gap-2.5 sm:hidden">
        <legend className="sr-only">Quotes</legend>
        {quoted.map((q) => {
          const on = q.id === choice?.id;
          return (
            <label key={q.id} className={`flex cursor-pointer gap-3 rounded-xl p-3.5 ${on ? 'border-2 border-brand bg-[#F3F8F8]' : 'border border-line'}`}>
              <input type="radio" name="award-phone" checked={on} onChange={() => setPicked(q.id)} aria-label={`Pick ${q.carrier}`} className="mt-1 h-[18px] w-[18px] flex-none accent-brand" />
              <span className="flex-1">
                <span className="flex justify-between gap-2"><strong>{q.carrier}</strong><strong className="tabular">{rupees(q.amount)}</strong></span>
                {q.rank === 1 && <span className="block text-xs font-semibold text-brand-dark">Recommended · score {q.score}</span>}
                <span className="mt-1 block text-[13px] text-ink-muted">
                  {q.rank !== 1 && `Score ${q.score} · `}
                  {q.onTimePct != null ? `${q.onTimePct}% on time · POD ${q.podDays} days` : 'No track record yet'}
                  {q.vsBudget != null && ` · ${q.vsBudget <= 0 ? `${rupees(-q.vsBudget)} under` : `${rupees(q.vsBudget)} over`}`}
                </span>
              </span>
            </label>
          );
        })}
        {others.map((q) => (
          <div key={q.id} className="flex items-center justify-between rounded-xl border border-dashed border-line px-3.5 py-2.5 text-sm text-ink-muted">
            <span>{q.carrier}</span>
            <Chip tone={QUOTE_CHIP[q.status].tone}>{QUOTE_CHIP[q.status].label}</Chip>
          </div>
        ))}
      </fieldset>
      {trip.recommendation && (
        <p className="mt-3.5 rounded-xl bg-brand-soft px-4 py-3.5 text-sm leading-relaxed">
          <strong>Why {trip.recommendation.carrier}:</strong> {trip.recommendation.reason}
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-tone-danger">{error}</p>}
      {blocked && <p className="mt-3 rounded-xl bg-tone-action-bg px-4 py-3 text-sm text-[#6B2E08]">{blocked}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Button onClick={award} loading={busy} disabled={!!blocked || !choice}>
          Award to {choice?.carrier} · {rupees(choice?.amount)}
        </Button>
        {!rejecting && <Button variant="danger" onClick={() => setRejecting(true)}>Reject all and ask again</Button>}
        <span className="text-[13px] text-ink-muted">Carriers never see each other&apos;s quotes.</span>
      </div>
      {rejecting && <RetenderForm tripId={trip.id} label="Reject all and ask again" onDone={onChanged} onCancel={() => setRejecting(false)} />}
      {!trip.quotesClosedAt && <WidenRequest trip={trip} onChanged={onChanged} />}
    </Card>
  );
}

function AwardedPanel({ trip, onChanged }: { trip: TripDetail; onChanged: () => void }) {
  const toast = useToast();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, []);
  const left = trip.undoUntil ? Math.ceil((new Date(trip.undoUntil).getTime() - now) / 60_000) : 0;
  const undo = async () => {
    setBusy(true);
    try {
      await api(`/trips/${trip.id}/undo-award`, { method: 'POST' });
      toast({ tone: 'success', title: 'Award undone.', text: 'Choose again from the quotes.' });
    } catch (err) {
      toast({ tone: 'error', title: err instanceof ApiError ? err.body.message : 'Could not undo.' });
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Awarded to {trip.carrier} · {rupees(trip.amount)}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        Next: the carrier assigns a truck and driver. You&apos;ll get the truck number, driver contact and LR, usually within 2 hours. Nothing else is needed from you.
      </p>
      {left > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button size="sm" variant="secondary" onClick={undo} loading={busy}>Undo award</Button>
          <span className="text-[13px] text-ink-muted">Possible for {left} more minute{left === 1 ? '' : 's'}. Other carriers are told after that.</span>
        </div>
      )}
    </Card>
  );
}

function TaskPanel({ trip, onChanged }: { trip: TripDetail; onChanged: () => void }) {
  if (trip.status === 'QUOTES_RECEIVED') return <ComparePanel trip={trip} onChanged={onChanged} />;
  if (trip.status === 'AWARDED') return <AwardedPanel trip={trip} onChanged={onChanged} />;
  if (trip.status === 'QUOTES_REQUESTED' && trip.noQuotes) {
    return (
      <Card className="border-[#E9C9A0] p-5">
        <h2 className="text-lg font-semibold">No quotes by the deadline</h2>
        <p className="mt-1.5 text-sm text-ink-muted">
          None of the {trip.quotes.length} carriers quoted. Ask them again with a new deadline, or <Link href="/masters?tab=lanes" className="underline">add carriers to this lane</Link> first.
        </p>
        <RetenderForm tripId={trip.id} label="Ask the same carriers again" onDone={onChanged} />
        <WidenRequest trip={trip} onChanged={onChanged} />
      </Card>
    );
  }
  if (trip.status === 'QUOTES_REQUESTED') {
    return (
      <Card className="p-5">
        <h2 className="text-lg font-semibold">Waiting for quotes</h2>
        <p className="mb-3.5 mt-1.5 text-sm text-ink-muted">
          Sent to {trip.quotes.length} approved carriers. Closes at {trip.quoteDeadline ? timeIST(trip.quoteDeadline) : '—'}, or earlier if all reply. The quotes appear here when it&apos;s time to choose.
        </p>
        <div className="flex flex-wrap gap-2">
          {trip.quotes.map((q) => <Chip key={q.id} tone={QUOTE_CHIP[q.status].tone}>{q.carrier} · {QUOTE_CHIP[q.status].label.toLowerCase()}</Chip>)}
        </div>
        <WidenRequest trip={trip} onChanged={onChanged} />
      </Card>
    );
  }
  if (trip.status === 'READY_FOR_PICKUP') return <ReadyPanel trip={trip} onChanged={onChanged} />;
  if (trip.status === 'IN_TRANSIT') return <><TransitPanel trip={trip} onChanged={onChanged} /><DelayNote trip={trip} /></>;
  if (trip.status === 'ON_HOLD') return <OnHoldPanel trip={trip} onChanged={onChanged} />;
  if (trip.status === 'CANCELLED') return <CancelledPanel trip={trip} />;
  if (trip.status === 'DELIVERED') return <PodReviewPanel trip={trip} onChanged={onChanged} />;
  if (trip.status === 'POD_RECEIVED') return <PodAcceptedPanel trip={trip} onChanged={onChanged} />;
  if ((trip.status === 'INVOICED' || trip.status === 'CLOSED') && trip.invoice) return <InvoicePanel trip={trip} onChanged={onChanged} />;
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold"><TripStatusChip status={trip.status} /></h2>
      <p className="mt-2 text-sm text-ink-muted">{trip.nextStep}</p>
    </Card>
  );
}

export default function TripPage({ params }: { params: { id: string } }) {
  const res = useApi<{ trip: TripDetail }>(`/trips/${params.id}`);
  const trip = res.data?.trip;

  if (res.loading && !trip) return <Skeleton lines={5} />;
  if (res.error || !trip) {
    return <Card><EmptyState title="Trip not found" action={<Link href="/trips" className="underline">Back to trips</Link>}>{res.error ?? 'It may have been removed.'}</EmptyState></Card>;
  }

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-ink-muted">
        <Link href="/trips" className="font-semibold text-brand-dark hover:underline">← Trips</Link>
        <span aria-hidden="true">/</span>
        <span className="font-semibold text-ink">{trip.number}</span>
      </nav>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-bold">{trip.origin} → {trip.destination}</h1>
            <TripStatusChip status={trip.status} />
          </div>
          <p className="mt-1.5 text-sm text-ink-muted">{trip.number} · {trip.material} · {trip.truckType} · {tonnes(trip.weightTonnes)} · Pickup {dateShort(trip.pickupDate)}</p>
        </div>
        <TripActions trip={trip} onChanged={res.reload} />
      </div>
      {trip.status !== 'CANCELLED' && <Stepper status={trip.status} />}
      <TaskPanel trip={trip} onChanged={res.reload} />
      <ClaimsCard trip={trip} onChanged={res.reload} />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 text-base font-semibold">Details</h2>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-muted">Pickup</dt><dd>{trip.pickup ? `${trip.pickup.name}, ${trip.pickup.line1}, ${trip.pickup.city}` : '—'}</dd>
            <dt className="text-ink-muted">Drop</dt><dd>{trip.drop ? `${trip.drop.name}, ${trip.drop.line1}, ${trip.drop.city}` : '—'}</dd>
            <dt className="text-ink-muted">Carrier</dt><dd>{trip.carrier ?? 'Not yet chosen'}{trip.amount != null ? ` · ${rupees(trip.amount)}` : ''}</dd>
            {trip.truck && (<><dt className="text-ink-muted">Truck</dt><dd>{trip.truck.number} · {trip.truck.driverName}</dd></>)}
            {trip.reference && (<><dt className="text-ink-muted">Reference</dt><dd>{trip.reference}</dd></>)}
            {trip.receiverContact && (<><dt className="text-ink-muted">Receiver</dt><dd>{trip.receiverContact}</dd></>)}
            {trip.notes && (<><dt className="text-ink-muted">Notes</dt><dd>{trip.notes}</dd></>)}
          </dl>
        </Card>
        <DocumentsCard trip={trip} />
        <Card className="p-5">
          <h2 className="mb-3 text-base font-semibold">Activity</h2>
          <ol className="flex flex-col gap-2.5 text-[13px]">
            {trip.activity.map((a, i) => (
              <li key={i} className="grid grid-cols-[92px_1fr] gap-2">
                <span className="text-ink-muted">{dateTimeIST(a.at)}</span>
                <span>{a.text}<span className="text-ink-muted"> · {a.actor}</span></span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
