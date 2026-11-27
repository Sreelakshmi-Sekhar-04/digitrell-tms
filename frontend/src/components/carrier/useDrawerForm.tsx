'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formErrors } from '@/lib/useApi';
import { useToast } from '@/components/ui/Toast';

/**
 * Shared state for the add/edit drawer used by every carrier master (design: one drawer, create and
 * edit look the same). `open(row)` edits, `open('new')` adds; `send` posts and shows field errors.
 */
export function useDrawerForm<Row extends { id: string }, Form extends Record<string, unknown>>(empty: Form, fromRow: (r: Row) => Form) {
  const toast = useToast();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [form, setForm] = useState<Form>(empty);
  const [initial, setInitial] = useState<Form>(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  /** `defaults` pre-fills a new record (e.g. today's date) without marking the form as changed. */
  const open = (r: Row | 'new', defaults?: Partial<Form>) => {
    const f = r === 'new' ? { ...empty, ...defaults } : fromRow(r);
    setForm(f);
    setInitial(f);
    setErrors({});
    setFormError('');
    setEditing(r);
  };
  const close = () => setEditing(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k as string]: '' }));
  };

  /** Sends `body` to `path` and toasts `done`. Returns the response, or null when it failed. */
  async function send<T>(path: string, method: 'POST' | 'PATCH' | 'PUT', body: unknown, done: string, keepOpen = false): Promise<T | null> {
    setBusy(true);
    setFormError('');
    try {
      const res = await api<T>(path, { method, json: body });
      toast({ tone: 'success', title: done });
      if (!keepOpen) setEditing(null);
      return res;
    } catch (err) {
      const { fields, message } = formErrors(err);
      setErrors(fields);
      setFormError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  const current = editing && editing !== 'new' ? editing : null;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  return { editing, current, form, set, setForm, errors, formError, busy, open, close, send, dirty, isNew: editing === 'new' };
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="rounded-xl border border-[#E9B8B8] bg-tone-danger-bg px-4 py-3 text-sm font-semibold text-[#7A1616]">{message}</p>;
}
