'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { download } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { dateTimeIST } from '@/lib/trips';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from '@/components/masters/Table';

interface Entry {
  id: string;
  at: string;
  who: string;
  isPerson: boolean;
  action: string;
  text: string;
  record: string | null;
  tripId: string | null;
  reason: string | null;
  channel: string;
}
interface Res {
  entries: Entry[];
  page: number;
  pageSize: number;
  total: number;
}

const sel = 'min-h-[40px] rounded-btn border border-line-strong bg-white px-3 text-sm';

export default function ActivityPage() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [who, setWho] = useState('all');
  const [type, setType] = useState('all');
  const [days, setDays] = useState('7');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, who, type, days]);
  const query = new URLSearchParams({ q: debounced, who, type, days, page: String(page) }).toString();
  const res = useApi<Res>(`/activity?${query}`);
  const pages = res.data ? Math.max(1, Math.ceil(res.data.total / res.data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <nav aria-label="Breadcrumb" className="text-[13px]"><Link href="/reports" className="font-semibold text-brand-dark hover:underline">← Reports</Link></nav>
      <PageHeader
        title="Activity log"
        subtitle="Every agent action and human decision, with who, when and why. Read-only: entries can't be edited or deleted."
        actions={<Button variant="secondary" onClick={() => download(`/activity/export.csv?${new URLSearchParams({ q: debounced, who, type, days })}`, 'activity-log.csv').catch(() => toast({ tone: 'error', title: 'The export could not be prepared.' }))}>Export CSV</Button>}
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
          <input aria-label="Trip number" placeholder="Trip no., e.g. TR-24131" value={q} onChange={(e) => setQ(e.target.value)} className={`${sel} w-56`} />
          <select aria-label="Who" value={who} onChange={(e) => setWho(e.target.value)} className={sel}>
            <option value="all">Everyone</option>
            <option value="people">People only</option>
            <option value="agents">Agents and carriers</option>
          </select>
          <select aria-label="Action type" value={type} onChange={(e) => setType(e.target.value)} className={sel}>
            <option value="all">All actions</option>
            <option value="decisions">Approvals and decisions</option>
            <option value="money">Money</option>
            <option value="changes">Cancellations and edits</option>
            <option value="settings">Settings and users</option>
          </select>
          <select aria-label="Period" value={days} onChange={(e) => setDays(e.target.value)} className={sel}>
            <option value="1">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </div>
        {res.loading && !res.data ? (
          <div className="p-5"><Skeleton /></div>
        ) : res.error ? (
          <EmptyState title="Couldn't load the log" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState>
        ) : !res.data?.entries.length ? (
          <EmptyState title="Nothing in this view">Try a longer period or clear the filters.</EmptyState>
        ) : (
          <>
            <DataTable label="Activity" headers={['Time', 'Who', 'What', 'Record', 'Reason', 'Channel']}>
              {res.data.entries.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap`}>{dateTimeIST(e.at)}</td>
                  <td className={td}>{e.isPerson ? e.who : <span className="rounded-md bg-line-faint px-2 py-0.5 text-xs font-semibold text-ink-soft">{e.who}</span>}</td>
                  <td className={td}>{e.text}</td>
                  <td className={`${td} whitespace-nowrap`}>{e.record && e.tripId ? <Link href={`/trips/${e.tripId}`} className="font-semibold hover:underline">{e.record}</Link> : '—'}</td>
                  <td className={`${td} text-ink-muted`}>{e.reason ?? ''}</td>
                  <td className={`${td} text-ink-muted`}>{e.channel}</td>
                </tr>
              ))}
            </DataTable>
            <div className="flex items-center justify-between px-4 py-3 text-[13px] text-ink-muted">
              <span>{res.data.total} entr{res.data.total === 1 ? 'y' : 'ies'}{pages > 1 ? ` · page ${page} of ${pages}` : ''}</span>
              {pages > 1 && (
                <div className="flex gap-1.5">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
