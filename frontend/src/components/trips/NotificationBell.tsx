'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface Item { id: string; kind: string; tripId: string | null; title: string; body: string | null; read: boolean; createdAt: string }
interface Feed { unreadCount: number; notifications: Item[] }

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

/** Shipper header bell: unread badge, latest notifications, click opens the trip and marks it read. */
export function NotificationBell() {
  const router = useRouter();
  const [feed, setFeed] = useState<Feed>({ unreadCount: 0, notifications: [] });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setFeed(await api<Feed>('/notifications')); } catch { /* the bell is a convenience; stay quiet */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const openItem = async (n: Item) => {
    setOpen(false);
    if (!n.read) { try { await api(`/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* ignore */ } }
    load();
    if (n.tripId) router.push(`/trips/${n.tripId}`);
  };
  const readAll = async () => {
    try { await api('/notifications/read-all', { method: 'POST' }); } catch { /* ignore */ }
    load();
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        aria-label={feed.unreadCount ? `Notifications, ${feed.unreadCount} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
        data-testid="notif-bell"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-brand-dark hover:bg-brand-tint"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {feed.unreadCount > 0 && (
          <span data-testid="notif-badge" className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-tone-danger px-1 text-center text-[11px] font-bold leading-[18px] text-white">
            {feed.unreadCount > 9 ? '9+' : feed.unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div role="menu" data-testid="notif-list" className="absolute right-0 z-50 mt-2 w-[min(92vw,360px)] rounded-xl border border-line bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            <button type="button" onClick={readAll} disabled={!feed.unreadCount} className="text-[13px] font-semibold text-brand-dark disabled:opacity-40">Mark all read</button>
          </div>
          {feed.notifications.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">Nothing yet.</p>
          ) : (
            <ul className="max-h-[420px] overflow-y-auto">
              {feed.notifications.map((n) => (
                <li key={n.id}>
                  <button type="button" role="menuitem" onClick={() => openItem(n)} className={`block w-full border-b border-line-faint px-4 py-3 text-left hover:bg-brand-tint ${n.read ? '' : 'bg-[#F0F8F8]'}`}>
                    <span className={`block text-sm ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">{when(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
