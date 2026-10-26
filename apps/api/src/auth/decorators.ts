import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Permission } from '@nidhisetu/shared';
import type { Request } from 'express';
import type { Principal } from '../domain/scope.js';

export const IS_PUBLIC = 'ns:isPublic';
export const PERMISSIONS_KEY = 'ns:permissions';
export const AUTHENTICATED_ONLY = 'ns:authenticatedOnly';

/** No authentication needed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller's role must hold ANY of the listed permissions. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Any authenticated user (e.g. own profile, own notifications). */
export const AuthenticatedOnly = () => SetMetadata(AUTHENTICATED_ONLY, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: Principal }>();
  return req.user;
});
