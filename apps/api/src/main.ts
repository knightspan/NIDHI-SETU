import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { getConfig } from './config/config.js';

async function bootstrap(): Promise<void> {
  const config = getConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind the Next.js proxy / a load balancer: trust one hop for client IPs.
  app.set('trust proxy', 1);
  configureApp(app);
  await app.listen(config.API_PORT, '0.0.0.0');
}

void bootstrap();
