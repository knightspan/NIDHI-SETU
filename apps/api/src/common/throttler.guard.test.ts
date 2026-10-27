import { describe, expect, it } from 'vitest';
import { AppThrottlerGuard } from './throttler.guard.js';

const tracker = (req: Record<string, unknown>) =>
  (
    AppThrottlerGuard.prototype as unknown as { getTracker: (r: unknown) => Promise<string> }
  ).getTracker.call({}, req);

describe('AppThrottlerGuard tracker', () => {
  it('limits sign-in per IP and account, so one office IP does not lock everyone out', async () => {
    expect(await tracker({ ip: '10.0.0.1', body: { email: ' Ravi@Example.test ' } })).toBe(
      '10.0.0.1|ravi@example.test',
    );
    expect(await tracker({ ip: '10.0.0.1', body: { email: 'other@example.test' } })).not.toBe(
      await tracker({ ip: '10.0.0.1', body: { email: 'ravi@example.test' } }),
    );
  });
  it('keys MFA verification by the pending sign-in, and everything else by IP', async () => {
    expect(await tracker({ ip: '10.0.0.1', body: {}, cookies: { ns_mfa: 'abc' } })).toMatch(
      /^10\.0\.0\.1\|mfa:[0-9a-f]{16}$/,
    );
    expect(await tracker({ ip: '10.0.0.1', body: {} })).toBe('10.0.0.1');
  });
});
