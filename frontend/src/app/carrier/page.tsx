'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { dateShort, timeIST } from '@/lib/trips';
import { type LoadSummary, type CarrierApproval } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { ApprovalCard } from '@/components/carrier/ApprovalCard';

interface HomeRes {
  stats: {
    openRequests: { count: number; firstClosesAt: string | null };
    freeTomorrow: { count: number; of: number };
    unbilled: { amount: number; trips: number };
    unpaid: { amount: number; trips: number };
    margin: { pct: number | null; floorPct: number; trips: number };
    onRoad: number;
  };
  approvals: CarrierApproval[];
  approvalsCount: number;
  active: LoadSummary[];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
const lakh = (n: number) => (n >= 100000 ? `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} L` : rupees(n));

function Stat({ label, value, note, tone = 'muted' }: { label: string; value: string; note: string; tone?: 'muted' | 'warn' | 'good' }) {
  const color = tone === 'warn' ? 'text-[#8A3B0B]' : tone === 'good' ? 'text-tone-success' : 'text-ink-muted';
  return (
    <Card className="p-4">
      <div className="text-[13px] text-ink-muted">{label}</div>
      <div className="mt-1 font-display text-[26px] font-bold tabular">{value}</div>
      <div className={`text-xs ${color}`}>{note}</div>
    </Card>
  );
}

/** Carrier Home (design + spec C2): what needs me now, money, and loads on the go. */
export default function CarrierHomePage() {
  const { user } = useAuth();
  const res = useApi<HomeRes>('/carrier/home');
  const first = user?.name.split(/\s+/)[0] ?? '';
  const d = res.data;
  const s = d?.stats;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold leading-tight">{greeting()}, {first}</h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">
            {!d ? 'Loading your day…' : d.approvalsCount ? `${d.approvalsCount} ${d.approvalsCount === 1 ? 'decision is' : 'decisions are'} waiting for you. Everything else is moving.` : 'Nothing needs your decision right now.'}
          </p>
        </div>
        <Link href="/carrier/loads?tab=action" className="inline-flex min-h-[44px] items-center rounded-btn bg-brand px-[18px] text-sm font-semibold text-white hover:bg-brand-dark">Open load offers</Link>
      </div>

      {res.loading && !d ? (
        <Skeleton lines={5} />
      ) : res.error || !d || !s ? (
        <Card><EmptyState title="Couldn't load Home" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState></Card>
      ) : (
        <>
          <section aria-label="This month" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Load offers open" value={String(s.openRequests.count)} note={s.openRequests.firstClosesAt ? `First closes ${timeIST(s.openRequests.firstClosesAt)}` : 'None waiting'} tone={s.openRequests.count ? 'warn' : 'muted'} />
            <Stat label="Trucks free tomorrow" value={String(s.freeTomorrow.count)} note={`of ${s.freeTomorrow.of}, with valid documents`} />
            <Stat label="Unbilled after POD" value={lakh(s.unbilled.amount)} note={`${s.unbilled.trips} ${s.unbilled.trips === 1 ? 'trip' : 'trips'}`} tone={s.unbilled.trips ? 'warn' : 'muted'} />
            <Stat label="Average margin" value={s.margin.pct != null ? `${s.margin.pct}%` : '—'} note={`Floor ${s.margin.floorPct}%${s.margin.trips ? ` · ${s.margin.trips} trips` : ''}`} tone={s.margin.pct != null && s.margin.pct >= s.margin.floorPct ? 'good' : 'warn'} />
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <section aria-labelledby="ok-title" className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <h2 id="ok-title" className="text-lg font-bold">Needs your OK</h2>
                {d.approvalsCount > 3 && <Link href="/carrier/approvals" className="text-sm font-semibold text-brand-dark hover:underline">All {d.approvalsCount}</Link>}
              </div>
              {d.approvals.length === 0 ? (
                <Card><EmptyState title="All clear">Truck swaps, invoices and other decisions appear here.</EmptyState></Card>
              ) : (
                d.approvals.map((a) => <ApprovalCard key={a.id} a={a} />)
              )}
              <Card className="p-4">
                <div className="text-[13px] text-ink-muted">Invoices waiting for payment</div>
                <div className="mt-1 font-display text-xl font-bold tabular">{lakh(s.unpaid.amount)}</div>
                <div className="text-xs text-ink-muted">{s.unpaid.trips} {s.unpaid.trips === 1 ? 'invoice' : 'invoices'} · {s.onRoad} {s.onRoad === 1 ? 'load' : 'loads'} on the road</div>
              </Card>
            </section>

            <section aria-labelledby="active-title">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 id="active-title" className="text-lg font-bold">Active loads</h2>
                <Link href="/carrier/loads" className="text-sm font-semibold text-brand-dark hover:underline">All loads</Link>
              </div>
              <Card className="divide-y divide-line-faint">
                {d.active.length === 0 ? (
                  <EmptyState title="No active loads">Load offers from your shippers appear here.</EmptyState>
                ) : (
                  d.active.map((l) => (
                    <Link key={l.id} href={`/carrier/loads/${l.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-[#FAFBFB]">
                      <div className="min-w-0">
                        <div className="font-semibold">{l.origin} → {l.destination} <span className="text-xs font-normal text-ink-muted">{l.number}</span></div>
                        <div className="text-[13px] text-ink-muted">{l.shipper} · {l.truckType} · pickup {dateShort(l.pickupDate)} · {l.nextStep}</div>
                      </div>
                      <Chip tone={l.tone}>{l.label}</Chip>
                    </Link>
                  ))
                )}
              </Card>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

