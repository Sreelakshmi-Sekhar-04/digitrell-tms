'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ROLE_LABELS, useAuth } from '@/lib/auth';
import { SHIPPER_NAV, isActive } from '@/lib/nav';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
}

/** Header + sidebar (desktop) / bottom tabs (phone), per the approved design. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [moreOpen, setMoreOpen] = useState(false);
  const [approvals, setApprovals] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => setMoreOpen(false), [pathname]);

  // Approvals waiting: refreshed on every navigation and when a screen decides one.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () =>
      api<{ count: number }>('/approvals')
        .then((r) => alive && setApprovals(r.count))
        .catch(() => undefined);
    load();
    window.addEventListener('dtms:approvals-changed', load);
    return () => {
      alive = false;
      window.removeEventListener('dtms:approvals-changed', load);
    };
  }, [pathname, user]);

  const badge = (href: string) =>
    href === '/approvals' && approvals > 0 ? (
      <>
        <span aria-hidden="true" data-testid="approvals-badge" className="ml-auto min-w-[22px] rounded-full bg-attention px-1.5 text-center text-xs font-bold leading-[22px] text-white">{approvals}</span>
        <span className="sr-only">, {approvals} waiting</span>
      </>
    ) : null;

  if (!user) return null;

  const signOut = async () => {
    await logout();
    toast({ tone: 'info', title: 'Signed out.' });
    router.replace('/login');
  };

  const phonePrimary = SHIPPER_NAV.filter((n) => n.primaryOnPhone);
  const phoneMore = SHIPPER_NAV.filter((n) => !n.primaryOnPhone);
  const moreActive = phoneMore.some((n) => isActive(pathname, n.href));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-white px-4 py-3 md:px-6">
        <Link href="/" className="flex items-center gap-3 rounded-btn" aria-label="DigitRell TMS home">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-btn bg-brand font-display text-base font-bold text-white">D</span>
          <span>
            <span className="block font-display text-[17px] font-bold leading-tight">DigitRell TMS</span>
            <span className="block text-xs text-ink-muted" data-testid="company-name">{user.companyName}</span>
          </span>
        </Link>
        <form
          role="search"
          className="order-last hidden w-full md:order-none md:flex md:w-auto"
          onSubmit={(e) => {
            e.preventDefault();
            const q = search.trim();
            router.push(q ? `/trips?q=${encodeURIComponent(q)}&days=all` : '/trips');
          }}
        >
          <label className="flex min-h-[40px] w-full items-center gap-2 rounded-btn border border-line-strong bg-[#FAFBFB] px-3 md:w-[300px]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#52606D" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input aria-label="Search all trips" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search trip, city, carrier, ref." className="w-full bg-transparent text-sm outline-none" />
          </label>
        </form>
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-tint text-[13px] font-bold text-brand-dark">{initials(user.name)}</span>
          <span className="hidden text-[13px] leading-tight sm:block">
            <span className="block font-semibold" data-testid="user-name">{user.name}</span>
            <span className="block text-ink-muted">{ROLE_LABELS[user.role] ?? user.role}</span>
          </span>
          <Link href="/profile/messages" className="hidden min-h-[36px] items-center rounded-lg px-3 text-[13px] font-semibold text-brand-dark hover:bg-brand-tint md:inline-flex">
            My messages
          </Link>
          <button type="button" onClick={signOut} className="hidden min-h-[36px] rounded-lg px-3 text-[13px] font-semibold text-brand-dark hover:bg-brand-tint md:inline-flex md:items-center">
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1">
        <nav aria-label="Main" className="hidden w-60 shrink-0 flex-col gap-1 border-r border-line bg-white px-3 py-4 md:flex">
          {SHIPPER_NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[44px] items-center rounded-btn px-3.5 text-sm ${active ? 'bg-brand-tint font-bold text-brand' : 'font-medium text-ink-soft hover:bg-[#F1F5F4]'}`}
              >
                {n.label}
                {badge(n.href)}
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-6 md:px-7 md:pb-12">{children}</main>
      </div>

      {/* Phone: 4 bottom tabs; "More" opens the rest. */}
      <nav aria-label="Main (phone)" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-white md:hidden">
        {phonePrimary.map((n) => {
          const active = isActive(pathname, n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined} className={`flex min-h-[60px] items-center justify-center text-xs font-semibold ${active ? 'text-brand' : 'text-ink-muted'}`}>
              <span className="flex items-center gap-1">{n.label}{badge(n.href)}</span>
            </Link>
          );
        })}
        <button type="button" aria-expanded={moreOpen} aria-controls="more-menu" onClick={() => setMoreOpen((o) => !o)} className={`min-h-[60px] text-xs font-semibold ${moreActive || moreOpen ? 'text-brand' : 'text-ink-muted'}`}>
          More
        </button>
      </nav>
      {moreOpen && (
        <div id="more-menu" className="fixed inset-x-0 bottom-[60px] z-40 border-t border-line bg-white p-3 shadow-float md:hidden">
          {phoneMore.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(pathname, n.href) ? 'page' : undefined} className="flex min-h-[48px] items-center rounded-btn px-3 text-sm font-medium hover:bg-brand-tint">
              {n.label}
            </Link>
          ))}
          <Link href="/profile/messages" className="flex min-h-[48px] items-center rounded-btn px-3 text-sm font-medium hover:bg-brand-tint">My messages</Link>
          <button type="button" onClick={signOut} className="flex min-h-[48px] w-full items-center rounded-btn px-3 text-left text-sm font-semibold text-brand-dark hover:bg-brand-tint">
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
