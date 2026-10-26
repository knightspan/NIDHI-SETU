'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: {
      message?: string | string[];
      issues?: { path: string; message: string }[];
    } & Record<string, unknown>,
  ) {
    super(
      Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? `HTTP ${status}`),
    );
    this.name = 'ApiError';
  }
}

function csrfToken(): string {
  const m = /(?:^|;\s*)ns_csrf=([^;]+)/.exec(document.cookie);
  return m ? decodeURIComponent(m[1]!) : '';
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': csrfToken() },
  })
    .then((r) => r.ok)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  formData?: FormData;
  /** Don't attempt a token refresh on 401 (used by auth calls). */
  noRefresh?: boolean;
}

/** Same-origin JSON client: cookies carry auth, the CSRF header is echoed on writes. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.formData ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  if (opts.body !== undefined) headers['content-type'] = 'application/json';

  // Make sure the CSRF cookie exists before the first write.
  if (method !== 'GET' && !csrfToken()) await fetch('/api/health', { credentials: 'same-origin' });
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();

  const doFetch = () =>
    fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.formData ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });

  let res = await doFetch();
  if (res.status === 401 && !opts.noRefresh && (await tryRefresh())) res = await doFetch();
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as ApiError['body'];
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? await res.json() : await res.text()) as T;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.body.issues?.length)
      return e.body.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
