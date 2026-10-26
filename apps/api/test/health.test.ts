import type { INestApplication } from '@nestjs/common';
import { HealthResponseSchema } from '@nidhisetu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, createTestApp } from './helpers.js';

describe('GET /api/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('is public and reports the database as reachable', async () => {
    const c = await Client.anonymous(app);
    const res = await c.get('/api/health').expect(200);
    expect(HealthResponseSchema.parse(res.body).status).toBe('ok');
  });

  it('sets security headers', async () => {
    const c = await Client.anonymous(app);
    const res = await c.get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves the OpenAPI document', async () => {
    const c = await Client.anonymous(app);
    const res = await c.get('/api/docs/openapi.json').expect(200);
    expect((res.body as { info: { title: string } }).info.title).toBe('NidhiSetu API');
  });
});
