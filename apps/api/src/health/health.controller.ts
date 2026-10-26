import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@nidhisetu/shared';

@Controller('health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      status: 'ok',
      service: 'api',
      version: process.env.npm_package_version ?? '0.1.0',
      time: new Date().toISOString(),
    };
  }
}
