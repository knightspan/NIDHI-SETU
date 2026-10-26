import { z } from 'zod';

/** Response of `GET /api/health`. Shared so the web app can validate what the API returns. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  version: z.string(),
  time: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
