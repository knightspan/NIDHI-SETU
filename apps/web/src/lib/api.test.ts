import { describe, expect, it } from 'vitest';
import { fetchHealth } from './api';

describe('fetchHealth', () => {
  it('parses a valid response', async () => {
    const body = { status: 'ok', service: 'api', version: '0.1.0', time: new Date().toISOString() };
    const fake: typeof fetch = () => Promise.resolve(new Response(JSON.stringify(body)));
    expect((await fetchHealth(fake))?.status).toBe('ok');
  });

  it('returns null when the API is unreachable', async () => {
    const failing: typeof fetch = () => Promise.reject(new Error('ECONNREFUSED'));
    expect(await fetchHealth(failing)).toBeNull();
  });
});
