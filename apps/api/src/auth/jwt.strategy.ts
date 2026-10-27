import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Role } from '@nidhisetu/shared';
import type { Request } from 'express';
import { Strategy } from 'passport-jwt';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { Principal } from '../domain/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ACCESS_COOKIE } from './cookies.js';

export const JWT_ISSUER = 'nidhisetu';
export const JWT_AUDIENCE = 'nidhisetu-api';

export interface AccessPayload {
  sub: string;
  role: Role;
  typ: 'access';
}

/** Passport JWT strategy reading the access token from the httpOnly cookie (never from JS). */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: (req: Request) =>
        (req?.cookies as Record<string, string> | undefined)?.[ACCESS_COOKIE] ?? null,
      secretOrKey: config.JWT_ACCESS_SECRET,
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  /** Re-reads the user so deactivation and role/scope changes take effect immediately. */
  async validate(payload: AccessPayload): Promise<Principal> {
    if (payload.typ !== 'access') throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        regionId: true,
        institutionId: true,
        bankId: true,
        active: true,
        mustChangePassword: true,
      },
    });
    if (!user?.active) throw new UnauthorizedException();
    return {
      id: user.id,
      role: user.role,
      regionId: user.regionId,
      institutionId: user.institutionId,
      bankId: user.bankId,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
