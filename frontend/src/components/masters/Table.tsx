import type { ReactNode } from 'react';

/** Compact data table from the design system: 12 px caps headers, 44–48 px rows, scrolls sideways on phones. */
export function DataTable({ headers, children, label }: { headers: ReactNode[]; children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label={label}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap border-b border-line bg-[#FAFBFB] px-3.5 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = 'border-b border-line-faint px-3.5 py-3 align-middle';
