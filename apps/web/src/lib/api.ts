import { HealthResponseSchema, type HealthResponse } from '@nidhisetu/shared';

/** Base URL of the API as seen from the server side of the web app. */
export function apiBaseUrl(): string {
  return (process.env.API_INTERNAL_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
}

/** Fetches API health; returns null instead of throwing so the page can render a status. */
export async function fetchHealth(fetchImpl: typeof fetch = fetch): Promise<HealthResponse | null> {
  try {
    const res = await fetchImpl(`${apiBaseUrl()}/api/health`, { cache: 'no-store' });
    if (!res.ok) return null;
    return HealthResponseSchema.parse(await res.json());
  } catch {
    return null;
  }
}
