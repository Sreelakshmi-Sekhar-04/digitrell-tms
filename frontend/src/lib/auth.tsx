'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, tokenStore } from './api';

export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  role: string;
  /** Every role held, main role first (carrier users may hold several). */
  roles: string[];
  companyId: string;
  companyName: string;
  companyType: 'SHIPPER' | 'CARRIER';
  approvalLimit: number | null;
}

type Status = 'loading' | 'signed-in' | 'signed-out';

interface AuthState {
  status: Status;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  adoptSession: (token: string, user: SessionUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export const ROLE_LABELS: Record<string, string> = {
  LOGISTICS_HEAD: 'Logistics head (approver)',
  BOOKING_EXECUTIVE: 'Booking executive',
  ACCOUNTS_PAYABLE: 'Accounts payable',
  APPROVER: 'Approver',
  OWNER: 'Owner (approver)',
  TRAFFIC_MANAGER: 'Traffic manager',
  ACCOUNTS: 'Accounts',
};

/** Where each kind of company works: shippers at `/`, carriers at `/carrier`. */
export function homeFor(user: Pick<SessionUser, 'companyType'>) {
  return user.companyType === 'CARRIER' ? '/carrier' : '/';
}

/** True when `path` belongs to the workspace of this kind of company. */
export function inWorkspace(user: Pick<SessionUser, 'companyType'>, path: string) {
  const carrierPath = path === '/carrier' || path.startsWith('/carrier/');
  return user.companyType === 'CARRIER' ? carrierPath : !carrierPath;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    if (!tokenStore.get()) {
      setStatus('signed-out');
      return;
    }
    api<{ user: SessionUser }>('/auth/me')
      .then(({ user }) => {
        setUser(user);
        setStatus('signed-in');
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) tokenStore.clear();
        setUser(null);
        setStatus('signed-out');
      });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: SessionUser }>('/auth/login', { method: 'POST', json: { email, password } });
    tokenStore.set(res.token);
    setUser(res.user);
    setStatus('signed-in');
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* the session is dropped locally either way */
    }
    tokenStore.clear();
    setUser(null);
    setStatus('signed-out');
  }, []);

  /** Starts a session the server already created (e.g. after accepting an invite). */
  const adoptSession = useCallback((token: string, u: SessionUser) => {
    tokenStore.set(token);
    setUser(u);
    setStatus('signed-in');
  }, []);

  const value = useMemo(() => ({ status, user, login, logout, adoptSession }), [status, user, login, logout, adoptSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
