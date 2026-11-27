'use client';

import Link from 'next/link';
import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { dateShort, tonnes } from '@/lib/trips';
import type { LoadSummary } from '@/lib/carrier';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { DataTable, td } from '@/components/masters/Table';

type Tab = 'all' | 'action' | 'transit' | 'delivered' | 'closed';
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Needs action' },
  { id: 'transit', label: 'In transit' },
  { id: 'delivered', label: 'Delivered and billed' },
  { id: 'closed', label: 'Closed' },
];

/** Loads (design: carrier "Loads"): load offers and won trips, needs-action first. */
function LoadsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'all') as Tab;
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const list = useApi<{ loads: LoadSummary[]; counts: Record<Tab, number> }>(`/carrier/loads?group=${tab}&q=${encodeURIComponent(q)}`);

  const go = (next: { tab?: Tab; q?: string }) => {
    const p = new URLSearchParams(params.toString());
    if (next.tab) p.set('tab', next.tab);
    if (next.q !== undefined) (next.q ? p.set('q', next.q) : p.delete('q'));
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  };
  // Search updates the URL after a short pause. Opening a load cancels a pending update, so the
  // delayed replace can't pull you back to the list.
  const searchTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    searchTimer.current = window.setTimeout(() => search !== q && go({ q: search }), 300);
    return () => window.clearTimeout(searchTimer.current);
  }, [search]);
  const cancelPendingSearch = () => window.clearTimeout(searchTimer.current);

  const counts = list.data?.counts;
  const rows = list.data?.loads ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Loads" subtitle="Load offers from your shippers at their contract rate, and the loads you won." />
      <Card className="overflow-hidden">
        <Tabs label="Loads" tabs={TABS.map((t) => ({ ...t, count: counts?.[t.id] }))} value={tab} onChange={(id) => go({ tab: id })} />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3">
          <div className="w-full max-w-xs">
            <label htmlFor="load-search" className="sr-only">Search loads</label>
            <input
              id="load-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search load, shipper or city"
              className="min-h-[40px] w-full rounded-btn border border-line-strong bg-white px-3 text-sm focus:border-brand focus:outline focus:outline-2 focus:outline-brand"
            />
          </div>
          <span className="text-[13px] text-ink-muted" data-testid="load-count">{rows.length} shown</span>
        </div>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-2">
          {list.loading && !list.data ? (
            <div className="p-5"><Skeleton /></div>
          ) : list.error ? (
            <EmptyState title="Couldn't load your loads" action={<Button variant="secondary" onClick={list.reload}>Try again</Button>}>{list.error}</EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState title={q ? 'No loads match your search' : 'Nothing here'}>
              {q ? 'Try a load number, shipper or city.' : 'Load offers from shippers you have a contract rate with appear here, and on WhatsApp.'}
            </EmptyState>
          ) : (
            <DataTable label="Loads" headers={['Load', 'Lane', 'Shipper', 'Truck and load', 'Pickup', 'Status', 'Next step', 'Amount']}>
              {rows.map((l) => (
                <tr key={l.id} className="hover:bg-[#FAFBFB]">
                  <td className={td}>
                    <Link href={`/carrier/loads/${l.id}`} onClick={cancelPendingSearch} className="font-semibold text-brand-dark underline-offset-2 hover:underline">{l.number}</Link>
                  </td>
                  <td className={`${td} whitespace-nowrap font-semibold`}>{l.origin} → {l.destination}</td>
                  <td className={td}>{l.shipper}</td>
                  <td className={`${td} whitespace-nowrap`}>{l.truckType}<div className="text-xs text-ink-muted">{tonnes(l.weightTonnes)} · {l.material}</div></td>
                  <td className={`${td} whitespace-nowrap`}>{dateShort(l.pickupDate)}</td>
                  <td className={td}><Chip tone={l.tone}>{l.label}</Chip></td>
                  <td className={td}>{l.nextStep}</td>
                  <td className={`${td} whitespace-nowrap tabular`}>{l.amount != null ? rupees(l.amount) : '—'}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </div>
      </Card>
    </div>
  );
}

export default function CarrierLoadsPage() {
  return (
    <Suspense fallback={null}>
      <LoadsInner />
    </Suspense>
  );
}

