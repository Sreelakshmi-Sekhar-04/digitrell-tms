import type { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-card border border-line bg-white ${className}`} {...rest} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="m-0 text-[26px] font-bold leading-tight">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {children && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  const widths = ['60%', '85%', '40%', '70%', '55%'];
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3.5 animate-pulse rounded-md bg-[#E9EEEC]" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}
