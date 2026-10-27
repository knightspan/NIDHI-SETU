import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { MaskingLogger } from './common/pii.js';
import { getConfig } from './config/config.js';

async function bootstrap(): Promise<void> {
  const config = getConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Every log line passes through PII masking (emails, phones, account numbers, tokens).
    logger: new MaskingLogger(),
  });
  // Behind the Next.js proxy / a load balancer: trust one hop for client IPs.
  app.set('trust proxy', 1);
  configureApp(app);
  await app.listen(config.API_PORT, '0.0.0.0');
}

void bootstrap();
