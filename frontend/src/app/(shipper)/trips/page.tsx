'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { dateShort, tonnes, type TripSummary } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { TripStatusChip } from '@/components/ui/Chip';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable, td } from '@/components/masters/Table';
import type { Lane } from '@/components/masters/types';

type Tab = 'all' | 'action' | 'transit' | 'delivered' | 'closed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Needs action' },
  { id: 'transit', label: 'In transit' },
  { id: 'delivered', label: 'Delivered and billed' },
  { id: 'closed', label: 'Closed' },
];
interface ListRes {
  trips: TripSummary[];
  page: number;
  pageSize: number;
  total: number;
  counts: Record<Tab, number>;
}

function TripsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'all') as Tab;
  const q = params.get('q') ?? '';
  const laneId = params.get('laneId') ?? '';
  const days = params.get('days') ?? '30';
  const page = Number(params.get('page') ?? 1);
  const [search, setSearch] = useState(q);
  const searchTimer = useRef<number | undefined>(undefined);
  // The filters we last asked for. router.replace is asynchronous, so quick successive changes build
  // on this instead of on a URL that may not have updated yet.
  const wanted = useRef(params.toString());
  useEffect(() => {
    wanted.current = params.toString();
  }, [params]);

  const setParams = (next: Record<string, string>) => {
    const p = new URLSearchParams(wanted.current);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    if (!('page' in next)) p.delete('page');
    wanted.current = p.toString();
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };

  // Search as you type, after a short pause. Typing schedules it; Clear filters cancels it, so a
  // late update can't bring back filters that were just cleared.
  const onSearch = (value: string) => {
    setSearch(value);
    window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => setParams({ q: value.trim() }), 300);
  };
  const clearFilters = () => {
    window.clearTimeout(searchTimer.current);
    setSearch('');
    wanted.current = '';
    router.replace(pathname);
  };
  useEffect(() => () => window.clearTimeout(searchTimer.current), []);

  const query = new URLSearchParams({ tab, q, laneId, days: days === 'all' ? '0' : days, page: String(page) }).toString();
  const list = useApi<ListRes>(`/trips?${query}`);
  const lanes = useApi<{ lanes: Lane[] }>('/lanes');
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = !!(q || laneId || days !== '30');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Trips"
        subtitle="Click a row to open it."
        actions={<Link href="/bookings/new" className="inline-flex min-h-[44px] items-center rounded-btn bg-brand px-[18px] text-sm font-semibold text-white hover:bg-brand-dark">+ New booking</Link>}
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line">
          <Tabs label="Trip status" tabs={TABS.map((t) => ({ ...t, count: data?.counts[t.id] }))} value={tab} onChange={(id) => setParams({ tab: id === 'all' ? '' : id })} />
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            <label className="flex min-h-[36px] items-center gap-2 rounded-lg border border-line-strong bg-[#FAFBFB] px-2.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#52606D" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input aria-label="Search trips" value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Trip no., city, carrier, ref." className="w-52 bg-transparent text-[13px] outline-none" />
            </label>
            <select aria-label="Lane" value={laneId} onChange={(e) => setParams({ laneId: e.target.value })} className="min-h-[36px] rounded-lg border border-line-strong bg-white px-2 text-[13px]">
              <option value="">All lanes</option>
              {(lanes.data?.lanes ?? []).map((l) => <option key={l.id} value={l.id}>{l.origin} → {l.destination} · {l.truckType}</option>)}
            </select>
            <select aria-label="Booked in" value={days} onChange={(e) => setParams({ days: e.target.value === '30' ? '' : e.target.value })} className="min-h-[36px] rounded-lg border border-line-strong bg-white px-2 text-[13px]">
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">Any time</option>
            </select>
          </div>
        </div>

        {list.loading && !data ? (
          <div className="p-5"><Skeleton /></div>
        ) : list.error ? (
          <EmptyState title="Couldn't load trips" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>
        ) : data && data.trips.length === 0 ? (
          filtered || tab !== 'all' ? (
            <EmptyState title="No trips match" action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}>Try another tab, or clear the search, lane and date filters.</EmptyState>
          ) : (
            <EmptyState title="No trips yet" action={<Link href="/bookings/new" className="inline-flex min-h-[44px] items-center rounded-btn bg-brand px-[18px] text-sm font-semibold text-white">Book your first truck</Link>}>Your bookings and trips will appear here.</EmptyState>
          )
        ) : (
          data && (
            <>
              <DataTable label="Trips" headers={['Trip', 'Lane and load', 'Pickup', 'Carrier', 'Status', 'Next step', 'Amount']}>
                {data.trips.map((t) => (
                  <tr key={t.id} onClick={() => router.push(`/trips/${t.id}`)} className="cursor-pointer hover:bg-[#F4F9F9]">
                    <td className={`${td} font-semibold`}><Link href={`/trips/${t.id}`} onClick={(e) => e.stopPropagation()} className="text-ink hover:underline">{t.number}</Link></td>
                    <td className={td}>{t.origin} → {t.destination}<div className="text-xs text-ink-muted">{t.material} · {t.truckType} · {tonnes(t.weightTonnes)}</div></td>
                    <td className={`${td} whitespace-nowrap`}>{dateShort(t.pickupDate)}</td>
                    <td className={td}>{t.carrier ?? <span className="text-ink-muted">Not yet</span>}</td>
                    <td className={td}><TripStatusChip status={t.status} /></td>
                    <td className={`${td} text-ink-muted`}>{t.nextStep}</td>
                    <td className={`${td} tabular whitespace-nowrap text-right font-semibold`}>{t.amount != null ? rupees(t.amount) : t.budget != null ? <span className="font-normal text-ink-muted">Budget {rupees(t.budget)}</span> : '—'}</td>
                  </tr>
                ))}
              </DataTable>
              <div className="flex items-center justify-between px-4 py-3 text-[13px] text-ink-muted">
                <span>{data.total} trip{data.total === 1 ? '' : 's'}{pages > 1 ? ` · page ${page} of ${pages}` : ''}</span>
                {pages > 1 && (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>Previous</Button>
                    <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) })}>Next</Button>
                  </div>
                )}
              </div>
            </>
          )
        )}
      </Card>
    </div>
  );
}

export default function TripsPage() {
  return (
    <Suspense fallback={null}>
      <TripsInner />
    </Suspense>
  );
}
