'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Confirm dialog for irreversible actions only (design: "Cancel trip and void LR"). The safe choice
 * comes first and has focus; Esc or the backdrop closes it.
 */
export function Dialog({ open, title, onClose, children, actions }: { open: boolean; title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus(), 20);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[rgba(23,33,43,.45)] px-4 py-16">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="relative flex w-full max-w-[460px] flex-col gap-4 rounded-2xl bg-white p-6 shadow-float">
        <h2 id="dlg-title" className="text-xl font-bold">{title}</h2>
        {children}
        <div className="flex flex-wrap justify-end gap-2.5">{actions}</div>
      </div>
    </div>
  );
}
