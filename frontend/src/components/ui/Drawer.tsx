'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from './Button';

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** True when the form has unsaved changes; closing then asks once. */
  dirty?: boolean;
  onClose: () => void;
  onSubmit?: (e: FormEvent) => void;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Right-hand drawer used for every add/edit form (approved design: "Add truck and invite user").
 * Full width on phones. Esc or Cancel closes it; unsaved changes ask once before closing.
 */
export function Drawer({ open, title, subtitle, dirty, onClose, onSubmit, footer, children }: DrawerProps) {
  const [confirming, setConfirming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const requestClose = () => {
    if (dirty && !confirming) setConfirming(true);
    else {
      setConfirming(false);
      onClose();
    }
  };

  useEffect(() => {
    if (!open) return;
    setConfirming(false);
    const t = window.setTimeout(() => panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(23,33,43,.35)]" onClick={requestClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="drawer-title" className="relative flex h-full w-full max-w-[520px] flex-col bg-white shadow-float sm:rounded-l-2xl">
        <form onSubmit={onSubmit} noValidate className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
            <div>
              <h2 id="drawer-title" className="text-xl font-bold">{title}</h2>
              {subtitle && <p className="mt-1 text-[13px] text-ink-muted">{subtitle}</p>}
            </div>
            <button type="button" onClick={requestClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-brand-tint">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-6 py-5">{children}</div>
          {confirming ? (
            <div role="alert" className="flex flex-wrap items-center gap-2.5 border-t border-line bg-tone-action-bg px-6 py-4 text-sm text-[#6B2E08]">
              <span className="mr-auto font-semibold">Discard your changes?</span>
              <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Keep editing</Button>
              <Button size="sm" variant="danger" onClick={requestClose}>Discard</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2.5 border-t border-line bg-[#FAFBFB] px-6 py-4">
              {footer}
              <Button variant="ghost" onClick={requestClose}>Cancel</Button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
