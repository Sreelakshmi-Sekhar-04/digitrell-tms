import { Card, EmptyState, PageHeader } from '@/components/ui/Card';

/**
 * Placeholder for a shipper screen whose functionality lands in a later phase.
 * It says so plainly instead of showing controls that do nothing.
 */
export function ComingInPhase({ title, subtitle, phase, what }: { title: string; subtitle: string; phase: number; what: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={title} subtitle={subtitle} />
      <Card>
        <EmptyState title={`Arrives in phase ${phase}`}>{what}</EmptyState>
      </Card>
    </div>
  );
}
