export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const TOKEN_KEY = 'dtms.token';

export interface ApiErrorBody {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

/** Error thrown for any non-2xx response or network failure. */
export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

export const tokenStore = {
  get: () => {
    try { return window.localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set: (t: string) => {
    try { window.localStorage.setItem(TOKEN_KEY, t); } catch { /* private mode: session lasts this tab */ }
  },
  clear: () => {
    try { window.localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  },
};

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = tokenStore.get();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, body });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: "Can't reach DigitRell. Check your connection and try again." });
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? { code: 'HTTP_' + res.status, message: 'Something went wrong. Please try again.' });
  }
  return data as T;
}
