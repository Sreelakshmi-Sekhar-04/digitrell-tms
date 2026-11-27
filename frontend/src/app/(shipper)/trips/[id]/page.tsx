'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { STAGES, dateShort, dateTimeIST, stageOf, timeIST, tonnes, type QuoteRow, type TripDetail } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Chip, TripStatusChip, type Tone } from '@/components/ui/Chip';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { ClaimsCard, DocumentsCard, InvoicePanel, PodAcceptedPanel, PodReviewPanel, ReadyPanel, TransitPanel } from '@/components/trips/ExecutionPanels';
import { CancelledPanel, DelayNote, ExtendOffer, OnHoldPanel, TripActions } from '@/components/trips/ExceptionPanels';

/** Chip tone for each step of the offer list. */
const QUOTE_CHIP: Record<QuoteRow['status'], { tone: Tone }> = {
  QUEUED: { tone: 'neutral' },
  REQUESTED: { tone: 'progress' },
  ACCEPTED: { tone: 'action' },
  AWARDED: { tone: 'success' },
  DECLINED: { tone: 'neutral' },
  EXPIRED: { tone: 'neutral' },
  REJECTED_BY_SHIPPER: { tone: 'danger' },
  WITHDRAWN: { tone: 'neutral' },
  QUOTED: { tone: 'neutral' },
  LOST: { tone: 'neutral' },
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

/** Every contract-rate carrier in offer order with its fixed rate and where it stands. Only the shipper sees this. */
function OfferList({ trip }: { trip: TripDetail }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-collapse text-sm" aria-label="Carriers in offer order">
        <thead>
          <tr>
            {['#', 'Carrier', 'Contract rate', 'Status'].map((h) => (
              <th key={h} scope="col" className={`whitespace-nowrap border-b border-line bg-[#FAFBFB] px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted ${h === 'Contract rate' ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trip.quotes.map((q, i) => (
            <tr key={q.id} className={q.status === 'REQUESTED' || q.status === 'ACCEPTED' ? 'bg-[#F0F8F8]' : ''}>
              <td className="border-b border-line-faint px-3.5 py-3 text-ink-muted">{q.sequence ?? i + 1}</td>
              <td className="border-b border-line-faint px-3.5 py-3">
                <div className="font-semibold">{q.carrier}</div>
                {q.status === 'DECLINED' && q.declineReason && <div className="mt-0.5 text-xs text-ink-muted">“{q.declineReason}”</div>}
                {q.status === 'REJECTED_BY_SHIPPER' && q.declineReason && <div className="mt-0.5 text-xs text-ink-muted">“{q.declineReason}”</div>}
                {q.status === 'REQUESTED' && q.respondBy && <div className="mt-0.5 text-xs text-ink-muted">Answer by {timeIST(q.respondBy)}</div>}
              </td>
              <td className="tabular border-b border-line-faint px-3.5 py-3 text-right font-bold">{rupees(q.amount)}</td>
              <td className="border-b border-line-faint px-3.5 py-3"><Chip tone={QUOTE_CHIP[q.status].tone}>{q.statusLabel}</Chip></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** While offering: who has the load now, who is waiting in line, and who passed. */
function OfferPanel({ trip, onChanged }: { trip: TripDetail; onChanged: () => void }) {
  const offered = trip.quotes.find((q) => q.status === 'REQUESTED');
  return (
    <Card className="p-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{offered ? `Offered to ${offered.carrier}` : 'Offering the load'}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {`The load goes to one carrier at a time, at its contract rate, lowest first. If a carrier passes or doesn't answer${trip.quoteDeadline ? ` by ${timeIST(trip.quoteDeadline)}` : ''}, it moves to the next.`}
          </p>
        </div>
      </div>
      <OfferList trip={trip} />
      <ExtendOffer trip={trip} onChanged={onChanged} />
    </Card>
  );
}

/** Every carrier passed or missed the response time. */
function NoCarrierPanel({ trip, onChanged }: { trip: TripDetail; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sendAgain = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/trips/${trip.id}/send-again`, { method: 'POST' });
      toast({ tone: 'success', title: 'Offers sent again.', text: 'Starting from the lowest contract rate.' });
    } catch (err) {
      setError(err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  return (
    <Card className="border-[#E9C9A0] p-5">
      <h2 className="text-lg font-semibold">No carrier accepted</h2>
      <p className="mt-1.5 text-sm text-ink-muted">
        Every carrier on contract for this lane passed or didn&apos;t answer in time. Send the offers again from the lowest rate, or cancel the booking. You can also check your <Link href="/masters?tab=rate-cards" className="underline">rate cards</Link> first.
      </p>
      <OfferList trip={trip} />
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-tone-danger">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Button onClick={sendAgain} loading={busy}>Send again</Button>
        <span className="self-center text-[13px] text-ink-muted">To cancel, use Cancel booking above.</span>
      </div>
    </Card>
  );
}

function AwardedPanel({ trip }: { trip: TripDetail }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Accepted by {trip.carrier} at {rupees(trip.amount)} (contract rate)</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        Next: the carrier assigns a truck and driver. You&apos;ll get the truck number, driver contact, usually within 2 hours; then the carrier issues the LR.
      </p>
      <OfferList trip={trip} />
    </Card>
  );
}

function WaitingForLr({ trip }: { trip: TripDetail }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">Truck assigned · carrier to issue the LR</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
        {trip.carrier} has assigned {trip.truck?.number ?? 'a truck'}{trip.truck?.driverName ? ` with ${trip.truck.driverName}` : ''}. The trip is ready for pickup once the carrier issues the LR; you can view and print it here then.
      </p>
    </Card>
  );
}

function TaskPanel({ trip, onChanged }: { trip: TripDetail; onChanged: () => void }) {
  if (trip.status === 'AWARDED') return <AwardedPanel trip={trip} />;
  if (trip.status === 'QUOTES_REQUESTED' && trip.noCarrierAccepted) return <NoCarrierPanel trip={trip} onChanged={onChanged} />;
  if (trip.status === 'QUOTES_REQUESTED') return <OfferPanel trip={trip} onChanged={onChanged} />;
  if (trip.status === 'TRUCK_CONFIRMED') return <WaitingForLr trip={trip} />;
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
