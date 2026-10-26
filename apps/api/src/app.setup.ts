import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { RequestContext } from './common/request-context.js';
import { getConfig } from './config/config.js';

/** Shared by main.ts and the integration tests so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication): INestApplication {
  const config = getConfig();
  app.setGlobalPrefix('api');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI needs inline styles/scripts on /api/docs.
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cookieParser());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const forwarded = req.header('x-forwarded-for')?.split(',')[0]?.trim();
    RequestContext.run(
      {
        ip: forwarded ?? req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
        requestId: req.header('x-request-id') ?? randomUUID(),
      },
      next,
    );
  });
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.enableShutdownHooks();

  const openapi = new DocumentBuilder()
    .setTitle('NidhiSetu API')
    .setDescription(
      'Security deposit / FDR lifecycle portal (SIH 2026 · PS 26265 · AICTE). Authentication uses ' +
        'httpOnly cookies set by POST /api/auth/login; state-changing calls need the x-csrf-token header ' +
        'echoing the ns_csrf cookie.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('ns_access')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, openapi), {
    jsonDocumentUrl: 'api/docs/openapi.json',
  });
  return app;
}
