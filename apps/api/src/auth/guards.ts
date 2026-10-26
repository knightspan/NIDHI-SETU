import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { hasPermission, type Permission } from '@nidhisetu/shared';
import type { Request } from 'express';
import type { Principal } from '../domain/scope.js';
import { AUTHENTICATED_ONLY, IS_PUBLIC, PERMISSIONS_KEY } from './decorators.js';

/** Global: every route needs a valid access token unless marked @Public(). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

/**
 * Global, default-deny: a non-public route must declare @RequirePermission(...) or
 * @AuthenticatedOnly(); otherwise it is refused (protects against forgotten annotations).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const user = context.switchToHttp().getRequest<Request & { user?: Principal }>().user;
    if (!user) throw new ForbiddenException();

    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY, targets)) return true;

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    if (!required) {
      this.logger.error(
        `Route ${context.getClass().name}.${context.getHandler().name} has no permission metadata`,
      );
      throw new ForbiddenException('Route not authorised');
    }
    if (!required.some((p) => hasPermission(user.role, p))) {
      throw new ForbiddenException('Your role is not allowed to do this');
    }
    return true;
  }
}
