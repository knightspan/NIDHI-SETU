import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

describe('HealthResponseSchema', () => {
  it('accepts a valid health payload', () => {
    const parsed = HealthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
      time: new Date().toISOString(),
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects an unknown status', () => {
    expect(() =>
      HealthResponseSchema.parse({ status: 'down', service: 'api', version: '0.1.0', time: 'x' }),
    ).toThrow();
  });
});
