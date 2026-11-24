'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/** Loads `path` on mount; exposes data, error, loading and reload(). */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(path));
    } catch (err) {
      setError(err instanceof ApiError ? err.body.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, setData, error, loading, reload };
}

/** Field errors from a 400/409 response, or a general message. */
export function formErrors(err: unknown): { fields: Record<string, string>; message: string } {
  if (err instanceof ApiError) return { fields: err.body.fields ?? {}, message: err.body.message };
  return { fields: {}, message: 'Something went wrong. Please try again.' };
}
