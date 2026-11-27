'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ApiError } from '@/lib/api';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formErrors, useApi } from '@/lib/useApi';
import { prettyPhone, rupees } from '@/lib/masters';
import { STAGES, dateShort, dateTimeIST, timeIST, tonnes } from '@/lib/trips';
import { hasRole, type LoadDetail } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { TextField } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { AssignForm, AssignedPanel, ReadyExtras, openLr } from '@/components/carrier/ExecutionPanels';
import { DeliveredPanel, HoldPanel, RoadPanel } from '@/components/carrier/RoadPanels';
import { ClosedPanel, InvoicePanel, InvoicedPanel } from '@/components/carrier/BillingPanels';

const DOC_LABEL: Record<string, string> = { LR: 'LR', EWAY_BILL: 'E-way bill', POD: 'POD photo', INVOICE: 'Invoice' };

function Stepper({ stage }: { stage: number }) {
  return (
    <Card className="overflow-x-auto px-5 py-4">
      <ol aria-label="Load progress" className="grid min-w-[720px] grid-cols-7 gap-2">
        {STAGES.map((l) => (l === 'Quotes' ? 'Offer' : l)).map((label, i) => {
          const done = i < stage;
          const cur = i === stage;
          return (
            <li key={label} aria-current={cur ? 'step' : undefined} className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5">
                <span className={`h-3.5 w-3.5 flex-none rounded-full ${done ? 'bg-brand' : cur ? 'border-[3px] border-brand bg-white' : 'border-2 border-[#A7B4B0] bg-white'}`} />
                {i < STAGES.length - 1 && <span className={`h-0.5 flex-1 ${done ? 'bg-brand' : 'bg-[#D5DDDA]'}`} />}
              </div>
              <span className={`text-[13px] ${cur ? 'font-bold text-ink' : done ? 'text-ink-soft' : 'text-ink-muted'}`}>{label}{done && <span className="sr-only"> (done)</span>}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/** "today at 14:30 (1 h 12 min left)" or "on 28 Nov, 14:30 (1 day 4 h left)". */
function closesText(deadline: string | null, minutesLeft: number | null) {
  if (!deadline) return 'soon';
  const ist = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const today = ist(new Date(deadline)) === ist(new Date());
  const when = today ? `today at ${timeIST(deadline)}` : `on ${dateTimeIST(deadline)}`;
  if (minutesLeft == null) return when;
  const d = Math.floor(minutesLeft / 1440);
  const h = Math.floor((minutesLeft % 1440) / 60);
  const m = minutesLeft % 60;
  const left = d ? `${d} day${d > 1 ? 's' : ''} ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  return `${when} (${left} left)`;
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-line-faint p-3.5">
      <div className="text-[13px] text-ink-muted">{label}</div>
      <div className="mt-1 font-display text-[22px] font-bold tabular">{value}</div>
      {note && <div className="mt-0.5 text-xs text-ink-muted">{note}</div>}
    </div>
  );
}

/** Contract-rate offer: the amount is fixed by the shipper's contract; the carrier can only accept or pass. */
function OfferPanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const o = load.offer!;
  const canAnswer = hasRole(user, 'OWNER', 'TRAFFIC_MANAGER');
  const [passing, setPassing] = useState(false);
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const left = o.respondBy ? Math.max(0, Math.round((new Date(o.respondBy).getTime() - Date.now()) / 60000)) : null;

  const call = async (path: string, body: unknown, done: () => void) => {
    setBusy(true);
    setFormError('');
    try {
      await api(path, { method: 'POST', json: body });
      done();
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.body.code === 'OFFER_CLOSED') {
        setFormError('This load is no longer offered to you.');
        onDone();
      } else {
        setFormError(formErrors(err).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="mb-3.5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">New load offer from {load.shipper}</h2>
          <p className="mt-1 text-sm text-ink-muted">{o.amount != null ? `Reply by ${closesText(o.respondBy, left)}.` : 'Rate not set – ask the shipper to send again.'} If you pass or do not answer in time, it goes to the next carrier.</p>
        </div>
        <Chip tone="action">Reply needed</Chip>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Contract rate" value={o.amount != null ? rupees(o.amount) : 'Not set'} note={o.amount != null ? 'per trip, fixed' : 'Ask the shipper to send again'} />
        <Kpi label="Respond by" value={o.respondBy ? timeIST(o.respondBy) : '—'} note={o.respondBy ? dateShort(o.respondBy) : undefined} />
        <Kpi label={`${load.truckType} trucks free on ${dateShort(load.pickupDate)}`} value={String(o.freeTrucks.length)} note={o.freeTrucks.join(', ') || 'None free with valid documents'} />
      </div>
      {formError && <p role="alert" className="mb-3 rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{formError}</p>}
      {!canAnswer ? (
        <p className="text-sm text-ink-muted">Only the owner or traffic manager can answer load offers.</p>
      ) : passing ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-sm">
            <TextField label="Why are you passing?" optional value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No truck free that day" />
          </div>
          <Button variant="danger" loading={busy} onClick={() => call(`/carrier/loads/${load.id}/decline`, { reason: reason || undefined }, () => toast({ tone: 'info', title: 'You passed on this load.', text: 'It goes to the next carrier.' }))}>Pass on this load</Button>
          <Button variant="ghost" onClick={() => setPassing(false)}>Back</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {o.amount != null && <Button loading={busy} onClick={() => call(`/carrier/loads/${load.id}/accept`, undefined, () => toast({ tone: 'success', title: 'You won this load. Assign a truck and driver.' }))}>Accept {rupees(o.amount)}</Button>}
          <Button variant="secondary" onClick={() => setPassing(true)}>Pass on this load</Button>
          {o.amount != null && <p className="w-full text-xs text-ink-muted">Accepting awards you this load at {rupees(o.amount)}.</p>}
        </div>
      )}
    </Card>
  );
}

function InfoPanel({ title, chip, children }: { title: string; chip?: { label: string; tone: LoadDetail['tone'] }; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-lg font-bold">{title}</h2>
        {chip && <Chip tone={chip.tone}>{chip.label}</Chip>}
      </div>
      <div className="text-sm leading-relaxed text-ink-muted">{children}</div>
    </Card>
  );
}

function StatusPanel({ load, onDone }: { load: LoadDetail; onDone: () => void }) {
  const x = load.execution;
  const amt = (n: number | null | undefined) => (n != null ? rupees(n) : '—');
  switch (load.panel) {
    case 'accepted': // legacy rows only; accepting now awards at once
      return <InfoPanel title={`You accepted · ${amt(load.amount)}`} chip={{ label: 'Awaiting shipper approval', tone: 'progress' }}>You accepted. Waiting for the shipper’s approval.</InfoPanel>;
    case 'closedRequest':
      return <InfoPanel title={load.label} chip={{ label: load.label, tone: 'neutral' }}>{load.nextStep}.</InfoPanel>;
    case 'cancelled':
      return <InfoPanel title="Cancelled by the shipper" chip={{ label: 'Cancelled', tone: 'neutral' }}>Nothing more is needed from you on this load.</InfoPanel>;
    case 'won':
      return (
        <Card className="p-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">You won this load · {amt(x?.awardedAmount)}</h2>
              <p className="mt-1 text-sm text-ink-muted">The shipper approved. Next: assign a truck and driver. Trucks of {load.truckType} that are free and compliant are listed first.</p>
            </div>
            <Chip tone="action">Won</Chip>
          </div>
          {x?.assignment && <AssignForm load={load} onDone={onDone} />}
        </Card>
      );
    case 'assigned':
      return <AssignedPanel load={load} onDone={onDone} />;
    case 'ready':
    case 'transit':
      return <RoadPanel load={load} onDone={onDone} />;
    case 'hold':
      return <HoldPanel load={load} onDone={onDone} />;
    case 'delivered':
      return <DeliveredPanel load={load} onDone={onDone} />;
    case 'unbilled':
      return <InvoicePanel load={load} onDone={onDone} />;
    case 'invoiced':
      return x?.invoice?.status === 'QUERIED' ? <InvoicePanel load={load} onDone={onDone} /> : <InvoicedPanel load={load} onDone={onDone} />;
    case 'closed':
      return <ClosedPanel load={load} />;
    default:
      return null;
  }
}

export default function CarrierLoadPage() {
  const { id } = useParams<{ id: string }>();
  const res = useApi<{ load: LoadDetail }>(`/carrier/loads/${id}`);

  if (res.loading && !res.data) return <Skeleton lines={6} />;
  if (res.error || !res.data) return <Card><EmptyState title="Couldn't open this load" action={<Link href="/carrier/loads" className="font-semibold text-brand-dark underline">Back to Loads</Link>}>{res.error}</EmptyState></Card>;
  const l = res.data.load;
  const x = l.execution;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-muted"><Link href="/carrier/loads" className="hover:underline">Loads</Link> › {l.number}</nav>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold leading-tight">{l.origin} → {l.destination}</h1>
          <p className="mt-1 text-sm text-ink-muted">{l.number} · {l.shipper} · {l.truckType} · {tonnes(l.weightTonnes)} {l.material?.toLowerCase()} · pickup {dateShort(l.pickupDate)}</p>
        </div>
        <Chip tone={l.tone}>{l.label}</Chip>
      </div>
      <Stepper stage={l.stage} />
      {l.panel === 'offer' && l.offer ? <OfferPanel load={l} onDone={res.reload} /> : <StatusPanel load={l} onDone={res.reload} />}
      {l.panel === 'ready' && <ReadyExtras load={l} onDone={res.reload} />}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold">Details</h2>
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-muted">Pickup</dt><dd>{l.pickup ? <>{l.pickup.name}, {l.pickup.city}<div className="text-xs text-ink-muted">{l.pickup.line1}</div></> : '—'}</dd>
            <dt className="text-ink-muted">Drop</dt><dd>{l.drop ? <>{l.drop.name}, {l.drop.city}{l.drop.line1 && <div className="text-xs text-ink-muted">{l.drop.line1}</div>}</> : '—'}</dd>
            <dt className="text-ink-muted">Pickup date</dt><dd>{dateShort(l.pickupDate)}</dd>
            <dt className="text-ink-muted">Load</dt><dd>{tonnes(l.weightTonnes)} · {l.material}</dd>
            <dt className="text-ink-muted">Truck type</dt><dd>{l.truckType}</dd>
            {x?.awardedAmount != null && <><dt className="text-ink-muted">Freight</dt><dd className="font-semibold">{rupees(x.awardedAmount)}</dd></>}
            {x?.receiverContact && <><dt className="text-ink-muted">Receiver</dt><dd>{prettyPhone(x.receiverContact)}</dd></>}
          </dl>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold">Documents</h2>
          {x && x.documents.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {x.documents.map((d, i) => (
                <li key={i} className="flex items-center justify-between gap-2">
                  <span>{DOC_LABEL[d.kind] ?? d.kind} {d.number}{d.kind === 'LR' && !d.isVoid && <> · <button type="button" onClick={() => openLr(l.id)} className="font-semibold text-brand-dark underline">View / print LR</button></>}{d.isVoid && d.voidReason && <span className="block text-xs text-ink-muted">Void: {d.voidReason}</span>}</span>
                  <Chip tone={d.isVoid ? 'neutral' : 'success'}>{d.isVoid ? 'Void' : d.validUntil ? `Valid to ${dateShort(d.validUntil)}` : 'Issued'}</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">You issue the LR after you assign a truck and driver.</p>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 text-base font-bold">Activity</h2>
          <ol className="flex flex-col gap-2.5 text-sm">
            {l.activity.map((a, i) => (
              <li key={i} className="grid grid-cols-[92px_1fr] gap-2"><span className="text-xs text-ink-muted tabular">{dateTimeIST(a.at)}</span><span>{a.text}</span></li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

