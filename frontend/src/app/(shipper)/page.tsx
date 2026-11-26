'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { ago, tonnes, type TripSummary } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Chip, TripStatusChip } from '@/components/ui/Chip';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from '@/components/masters/Table';

interface Approval {
  id: string;
  kind: string;
  kindLabel: string;
  tripId: string;
  ref: string;
  summary: string;
  reason: string;
  amount: number;
  createdAt: string;
}
interface Dashboard {
  firstTime: boolean;
  setup: { id: string; title: string; done: boolean }[];
  approvals: Approval[];
  approvalsCount: number;
  activeTrips: TripSummary[];
  month: { trips: number; awarded: number; spend: number; budget: number | null; delivered: number; onTimePct: number | null; avgPodDays: number | null; podsPending: number };
}

const SETUP_TEXT: Record<string, { text: string; href: string; cta: string }> = {
  addresses: { text: 'Pickup and drop points, with a contact for each.', href: '/masters?tab=addresses', cta: 'Add addresses' },
  lanes: { text: 'City pairs you ship on, with truck type and the carriers you trust on each.', href: '/masters?tab=lanes', cta: 'Add lanes' },
  carriers: { text: 'Quote requests go only to carriers you approve per lane.', href: '/masters?tab=lanes', cta: 'Approve carriers' },
  limits: { text: 'Who approves awards and payments, and up to what amount.', href: '/policies', cta: 'Check limits' },
  booking: { text: 'Book your first truck. The trip shows up here.', href: '/bookings/new', cta: 'Book now' },
};

function greeting() {
  const h = Number(new Date().toLocaleString('en-IN', { hour: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }));
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'warn' | 'muted' }) {
  const noteClass = tone === 'good' ? 'text-tone-success' : tone === 'warn' ? 'text-tone-action' : 'text-ink-muted';
  return (
    <div className="rounded-xl border border-line-faint p-3.5">
      <div className="text-[13px] text-ink-muted">{label}</div>
      <div className="tabular mt-1.5 font-display text-2xl font-bold">{value}</div>
      {note && <div className={`mt-1 text-xs ${noteClass}`}>{note}</div>}
    </div>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const toast = useToast();
  const res = useApi<Dashboard>('/insights/dashboard');
  const [busy, setBusy] = useState<string | null>(null);
  const d = res.data;
  const first = user?.name.split(' ')[0] ?? '';
  const limit = user?.approvalLimit ?? null;

  const approve = async (a: Approval) => {
    setBusy(a.id);
    try {
      await api(`/approvals/${a.id}/approve`, { method: 'POST' });
      toast({ tone: 'success', title: a.kind === 'AWARD' ? `${a.ref} awarded.` : a.kind === 'PAYMENT' ? `Invoice ${a.ref} approved.` : `${a.ref}: fix approved.` });
    } catch (err) {
      toast({ tone: 'error', title: err instanceof ApiError ? err.body.message : 'Could not approve.' });
    } finally {
      setBusy(null);
      res.reload();
      window.dispatchEvent(new Event('dtms:approvals-changed'));
    }
  };

  const subtitle = !d
    ? 'Your decisions, active trips and month at a glance.'
    : d.firstTime
      ? 'Welcome to DigitRell. Finish setup, then book your first truck.'
      : d.approvalsCount
        ? `${d.approvalsCount} decision${d.approvalsCount === 1 ? ' is' : 's are'} waiting for you.`
        : 'Nothing needs you right now. Everything is moving.';

  const budgetNote = d?.month.budget ? `${Math.round((d.month.spend / d.month.budget) * 100)}% of ${rupees(d.month.budget)} budget` : 'Add a budget when booking to compare';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-bold">Good {greeting()}, {first}</h1>
          <p className="mt-1.5 text-[15px] text-ink-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {d && !d.firstTime && <Link href="/bookings/new?repeat=last" className="inline-flex min-h-[44px] items-center rounded-btn border border-line-strong bg-white px-[18px] text-sm font-semibold hover:bg-[#F1F5F4]">Repeat last booking</Link>}
          <Link href="/bookings/new" className="inline-flex min-h-[44px] items-center rounded-btn bg-brand px-[18px] text-sm font-semibold text-white hover:bg-brand-dark">+ New booking</Link>
        </div>
      </div>

      {res.loading && !d && <Skeleton lines={4} />}
      {res.error && <Card><EmptyState title="Couldn't load your dashboard" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState></Card>}

      {d?.firstTime && (
        <Card className="p-5">
          <h2 className="text-lg font-semibold">Set up in five steps</h2>
          <p className="mb-4 mt-1 text-sm text-ink-muted">About 10 minutes. Quotes only go to carriers you approve.</p>
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {d.setup.map((s, i) => (
              <li key={s.id} className="flex flex-col gap-2.5 rounded-xl border border-line p-4">
                <div className="flex items-center gap-2.5">
                  <span aria-hidden="true" className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-bold ${s.done ? 'bg-brand text-white' : 'bg-brand-tint text-brand'}`}>{s.done ? '✓' : i + 1}</span>
                  <span className="font-semibold">{s.title}</span>
                </div>
                <span className="text-[13px] leading-relaxed text-ink-muted">{SETUP_TEXT[s.id]?.text}</span>
                {s.done ? <Chip tone="success">Done</Chip> : <Link href={SETUP_TEXT[s.id]?.href ?? '/'} className="inline-flex min-h-[36px] items-center self-start rounded-lg border border-line-strong px-3 text-[13px] font-semibold hover:bg-[#F1F5F4]">{SETUP_TEXT[s.id]?.cta}</Link>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {d && (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">Needs your decision</h2>
              {d.approvalsCount > 0 && <Link href="/approvals" className="text-[13px] font-semibold text-brand-dark hover:underline">See all {d.approvalsCount}</Link>}
            </div>
            {d.approvals.length === 0 ? (
              <EmptyState title="Nothing waiting for you">New approvals arrive here.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {d.approvals.map((a) => {
                  const canApprove = limit != null && a.amount <= limit;
                  return (
                    <li key={a.id} className="flex flex-col gap-2.5 rounded-xl border border-line px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-tone-action">{a.kindLabel} · <span data-testid="approval-ref">{a.ref}</span></div>
                          <div className="mt-1 font-semibold">{a.summary}</div>
                          <div className="mt-1 text-[13px] text-ink-muted">{a.reason}</div>
                        </div>
                        <div className="tabular whitespace-nowrap font-display text-[17px] font-bold">{rupees(a.amount)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => approve(a)} loading={busy === a.id} disabled={!canApprove} title={canApprove ? undefined : limit == null ? "Your role can't approve" : `Above your limit of ${rupees(limit)}`}>Approve</Button>
                        <Link href={`/trips/${a.tripId}`} className="inline-flex min-h-[36px] items-center rounded-lg border border-line-strong px-3 text-[13px] font-semibold hover:bg-[#F1F5F4]">Review</Link>
                        <span className="ml-auto text-xs text-ink-muted">waiting {ago(a.createdAt)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">This month</h2>
              <Link href="/reports" className="text-[13px] font-semibold text-brand-dark hover:underline">Reports</Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Trips booked" value={String(d.month.trips)} note={`${d.month.delivered} delivered`} tone="muted" />
              <Stat label="On time" value={d.month.onTimePct != null ? `${d.month.onTimePct}%` : '—'} note={d.month.onTimePct != null ? 'Delivered by the ETA given at loading' : 'After your first deliveries'} tone={d.month.onTimePct != null && d.month.onTimePct >= 90 ? 'good' : 'muted'} />
              <Stat label="Freight awarded" value={rupees(d.month.spend)} note={budgetNote} tone={d.month.budget && d.month.spend > d.month.budget ? 'warn' : 'muted'} />
              <Stat label="PODs to review" value={String(d.month.podsPending)} note={d.month.podsPending ? 'Delivered, waiting for POD' : 'None waiting'} tone={d.month.podsPending ? 'warn' : 'muted'} />
            </div>
          </Card>
        </div>
      )}

      {d && !d.firstTime && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="text-[17px] font-semibold">Active trips</h2>
            <Link href="/trips" className="text-[13px] font-semibold text-brand-dark hover:underline">All trips</Link>
          </div>
          {d.activeTrips.length === 0 ? (
            <EmptyState title="No active trips">Everything is delivered and paid.</EmptyState>
          ) : (
            <DataTable label="Active trips" headers={['Trip', 'Lane', 'Carrier', 'Status', 'Next step']}>
              {d.activeTrips.map((t) => (
                <tr key={t.id}>
                  <td className={`${td} font-semibold`}><Link href={`/trips/${t.id}`} className="hover:underline">{t.number}</Link></td>
                  <td className={td}>{t.origin} → {t.destination}<div className="text-xs text-ink-muted">{t.truckType} · {tonnes(t.weightTonnes)}</div></td>
                  <td className={td}>{t.carrier ?? <span className="text-ink-muted">Not yet</span>}</td>
                  <td className={td}><TripStatusChip status={t.status} /></td>
                  <td className={`${td} text-ink-muted`}>{t.nextStep}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Card>
      )}
    </div>
  );
}
