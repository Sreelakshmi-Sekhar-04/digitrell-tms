'use client';

import Link from 'next/link';
import { useState } from 'react';
import { download } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { rupees } from '@/lib/masters';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, PageHeader, Skeleton } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { DataTable, td } from '@/components/masters/Table';

interface Report {
  period: { key: string; label: string };
  kpis: { trips: number; awarded: number; spend: number; budget: number | null; delivered: number; onTimePct: number | null; avgPodDays: number | null; claims: number; claimValue: number };
  byLane: { lane: string; trips: number; spend: number; budget: number }[];
  scorecard: { carrier: string; trips: number; delivered: number; onTimePct: number | null; avgPodDays: number | null; vsBudgetPct: number | null }[];
}

function Kpi({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <Card className="p-4">
      <div className="text-[13px] text-ink-muted">{label}</div>
      <div className="tabular mt-1.5 font-display text-[28px] font-bold leading-tight">{value}</div>
      <div className={`mt-1 text-xs ${warn ? 'text-tone-action' : 'text-ink-muted'}`}>{note}</div>
    </Card>
  );
}

/**
 * Spend by lane: one series (spend) as sorted horizontal bars in the brand colour, the lane budget
 * as a thin dark tick on the same scale. Values sit in the table columns, so the chart and its
 * table view are one thing; each bar also has a hover/focus tooltip via its title.
 */
function SpendByLane({ rows }: { rows: Report['byLane'] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.spend, r.budget)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label="Freight awarded by lane">
        <thead>
          <tr>
            {['Lane', 'Trips', 'Awarded vs budget', 'Awarded', 'Budget'].map((h, i) => (
              <th key={h} scope="col" className={`whitespace-nowrap border-b border-line bg-[#FAFBFB] px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-muted ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const over = r.budget > 0 && r.spend > r.budget;
            return (
              <tr key={r.lane}>
                <td className={`${td} whitespace-nowrap font-semibold`}>{r.lane}</td>
                <td className={`${td} tabular`}>{r.trips}</td>
                <td className={`${td} w-[45%] min-w-[180px]`}>
                  <div className="relative h-4" title={`${r.lane}: ${rupees(r.spend)} awarded${r.budget ? ` of ${rupees(r.budget)} budget` : ''}`} tabIndex={0} aria-label={`${r.lane}: ${rupees(r.spend)} awarded${r.budget ? ` of ${rupees(r.budget)} budget` : ''}`}>
                    <div className="absolute inset-y-0 left-0 rounded-r-[4px] bg-brand" style={{ width: `${(r.spend / max) * 100}%` }} />
                    {r.budget > 0 && <div aria-hidden="true" className="absolute -inset-y-1 w-0.5 bg-ink" style={{ left: `calc(${(r.budget / max) * 100}% - 1px)` }} />}
                  </div>
                </td>
                <td className={`${td} tabular whitespace-nowrap text-right font-semibold ${over ? 'text-tone-danger' : ''}`}>{rupees(r.spend)}</td>
                <td className={`${td} tabular whitespace-nowrap text-right text-ink-muted`}>{r.budget ? rupees(r.budget) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 flex flex-wrap items-center gap-4 px-3.5 text-xs text-ink-muted">
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-3 w-5 rounded-r-[3px] bg-brand" /> Awarded</span>
        <span className="flex items-center gap-1.5"><span aria-hidden="true" className="inline-block h-4 w-0.5 bg-ink" /> Budget</span>
      </p>
    </div>
  );
}

export default function ReportsPage() {
  const toast = useToast();
  const [period, setPeriod] = useState('month');
  const res = useApi<Report>(`/insights/reports?period=${period}`);
  const [exporting, setExporting] = useState(false);
  const r = res.data;

  const exportCsv = async () => {
    setExporting(true);
    try {
      await download(`/insights/reports/trips.csv?period=${period}`, `trips-${period}.csv`);
    } catch {
      toast({ tone: 'error', title: 'The export could not be prepared. Please try again.' });
    } finally {
      setExporting(false);
    }
  };

  const k = r?.kpis;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        subtitle={r ? `${r.period.label} · all lanes` : 'Spend against budget, on-time delivery, POD speed and carrier scorecards.'}
        actions={
          <>
            <label className="sr-only" htmlFor="period">Period</label>
            <select id="period" value={period} onChange={(e) => setPeriod(e.target.value)} className="min-h-[44px] rounded-btn border border-line-strong bg-white px-3 text-sm">
              <option value="month">This month</option>
              <option value="last-month">Last month</option>
              <option value="90d">Last 90 days</option>
            </select>
            <Button variant="secondary" onClick={exportCsv} loading={exporting}>Export trips (CSV)</Button>
            <Link href="/reports/activity" className="inline-flex min-h-[44px] items-center rounded-btn border border-line-strong bg-white px-[18px] text-sm font-semibold hover:bg-[#F1F5F4]">Activity log</Link>
          </>
        }
      />
      {res.loading && !r && <Skeleton lines={4} />}
      {res.error && <Card><EmptyState title="Couldn't load reports" action={<Button variant="secondary" onClick={res.reload}>Try again</Button>}>{res.error}</EmptyState></Card>}
      {k && r && (
        <>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Freight awarded" value={rupees(k.spend)} note={k.budget ? `${Math.round((k.spend / k.budget) * 100)}% of ${rupees(k.budget)} budget` : 'No lane budgets set'} warn={!!k.budget && k.spend > k.budget} />
            <Kpi label="On-time delivery" value={k.onTimePct != null ? `${k.onTimePct}%` : '—'} note={k.onTimePct != null ? `of ${k.delivered} delivered, against the ETA at loading` : 'No deliveries yet'} />
            <Kpi label="Average POD time" value={k.avgPodDays != null ? `${k.avgPodDays} days` : '—'} note="Delivery to accepted POD" />
            <Kpi label="Trips" value={String(k.trips)} note={`${k.awarded} awarded · ${k.claims} claim${k.claims === 1 ? '' : 's'}${k.claimValue ? ` (${rupees(k.claimValue)})` : ''}`} />
          </div>
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <h2 className="px-5 pb-1 pt-4 text-[17px] font-semibold">Freight awarded by lane</h2>
              <p className="px-5 pb-3 text-[13px] text-ink-muted">Awarded amounts in the period, against each lane&apos;s budget.</p>
              {r.byLane.length ? <SpendByLane rows={r.byLane} /> : <EmptyState title="No awards in this period" />}
            </Card>
            <Card className="overflow-hidden">
              <h2 className="px-5 pb-3 pt-4 text-[17px] font-semibold">Carrier scorecard</h2>
              {r.scorecard.length ? (
                <DataTable label="Carrier scorecard" headers={['Carrier', 'Trips', 'On time', 'POD days', 'vs budget']}>
                  {r.scorecard.map((c) => (
                    <tr key={c.carrier}>
                      <td className={`${td} font-semibold`}>{c.carrier}</td>
                      <td className={`${td} tabular`}>{c.trips}</td>
                      <td className={`${td} tabular`}>{c.onTimePct != null ? `${c.onTimePct}%` : '—'}</td>
                      <td className={`${td} tabular`}>{c.avgPodDays ?? '—'}</td>
                      <td className={`${td} tabular ${c.vsBudgetPct != null && c.vsBudgetPct > 0 ? 'text-tone-danger' : ''}`}>{c.vsBudgetPct == null ? '—' : c.vsBudgetPct > 0 ? `+${c.vsBudgetPct}%` : `${c.vsBudgetPct}%`}</td>
                    </tr>
                  ))}
                </DataTable>
              ) : (
                <EmptyState title="No carriers used in this period" />
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
