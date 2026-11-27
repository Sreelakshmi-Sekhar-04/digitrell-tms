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

/** Downloads a file from the API (e.g. a CSV export) with the session token. */
export async function download(path: string, filename: string) {
  const token = tokenStore.get();
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, { code: 'HTTP_' + res.status, message: 'The export could not be prepared. Please try again.' });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Sends a file's raw bytes (bulk upload check/import) with the session token; same errors as `api`. */
export async function upload<T>(path: string, file: File): Promise<T> {
  return api<T>(path, { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
}

/** POSTs JSON and saves the file that comes back (e.g. a problems report). */
export async function downloadPost(path: string, json: unknown, filename: string) {
  const token = tokenStore.get();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { method: 'POST', headers, body: JSON.stringify(json) });
  } catch {
    throw new ApiError(0, { code: 'NETWORK', message: "Can't reach DigitRell. Check your connection and try again." });
  }
  if (!res.ok) throw new ApiError(res.status, { code: 'HTTP_' + res.status, message: 'The file could not be prepared. Please try again.' });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
