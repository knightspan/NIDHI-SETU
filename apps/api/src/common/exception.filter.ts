import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IllegalTransitionError } from '@nidhisetu/shared';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ScopeMisconfiguredError } from '../domain/scope.js';
import { DomainError } from '../domain/errors.js';
import { Prisma } from '../generated/prisma/client.js';

/** Maps domain errors to HTTP and keeps internals (stack traces, SQL) out of responses. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const { status, body } = this.map(exception);
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : exception);
    res.status(status).json(body);
  }

  private map(e: unknown): { status: number; body: Record<string, unknown> } {
    if (e instanceof HttpException) {
      const r = e.getResponse();
      const body = typeof r === 'string' ? { message: r } : (r as Record<string, unknown>);
      return { status: e.getStatus(), body: { statusCode: e.getStatus(), ...body } };
    }
    if (e instanceof IllegalTransitionError) {
      return {
        status: HttpStatus.CONFLICT,
        body: {
          statusCode: 409,
          error: 'IllegalTransition',
          message: e.message,
          from: e.from,
          to: e.to,
        },
      };
    }
    if (e instanceof DomainError) {
      return {
        status: e.status,
        body: { statusCode: e.status, error: e.code, message: e.message },
      };
    }
    if (e instanceof ZodError) {
      return {
        status: 400,
        body: {
          statusCode: 400,
          message: 'Validation failed',
          issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      };
    }
    if (e instanceof ScopeMisconfiguredError) {
      return { status: 403, body: { statusCode: 403, message: 'Account is not scoped correctly' } };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2025')
        return { status: 404, body: { statusCode: 404, message: 'Not found' } };
      if (e.code === 'P2002') {
        return { status: 409, body: { statusCode: 409, message: 'Duplicate record' } };
      }
    }
    return { status: 500, body: { statusCode: 500, message: 'Internal server error' } };
  }
}
