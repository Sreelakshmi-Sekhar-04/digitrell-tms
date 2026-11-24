'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  text?: string;
}

const ToastContext = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);

const toneClass: Record<ToastTone, string> = {
  success: 'bg-tone-success-bg border-[#B7E0C3] text-[#14532D]',
  error: 'bg-tone-danger-bg border-[#E9B8B8] text-[#7A1616]',
  info: 'bg-tone-progress-bg border-[#B9D9EE] text-[#0B3F60]',
};

/** Toasts say what happened and what comes next. They stay until dismissed or 6 s pass. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = Date.now() + Math.random();
      setToasts((ts) => [...ts, { ...t, id }]);
      window.setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:pr-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto flex w-full max-w-md items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-float ${toneClass[t.tone]}`}>
            <span><strong>{t.title}</strong>{t.text ? ` ${t.text}` : ''}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="min-h-[28px] rounded-md px-2 text-xs font-semibold hover:bg-black/5">Dismiss</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
