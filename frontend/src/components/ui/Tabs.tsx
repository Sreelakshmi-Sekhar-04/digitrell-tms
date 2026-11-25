'use client';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  count?: number;
}

/** Underlined tabs (design: Trips / masters tabs). Arrow keys move between tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: TabDef<T>[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-1 border-b border-line px-4 pt-2">
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
              onChange(next.id);
              document.getElementById(`tab-${next.id}`)?.focus();
            }}
            className={`min-h-[40px] border-b-2 px-3.5 text-sm font-semibold ${active ? 'border-brand text-brand' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {t.label}
            {t.count != null && <> <span className="ml-0.5 font-medium text-ink-muted">{t.count}</span></>}
          </button>
        );
      })}
    </div>
  );
}
