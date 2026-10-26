import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
