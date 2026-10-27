import { maskEmail } from '../common/pii.js';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MFA_MANDATORY_ROLES, permissionsFor, type LoginResult, type Me } from '@nidhisetu/shared';
import argon2 from 'argon2';
import { randomToken, sha256Hex } from '../common/crypto.js';
import { RequestContext } from '../common/request-context.js';
import { AuditService } from '../audit/audit.service.js';
import { ClockService } from '../clock/clock.service.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import type { Principal } from '../domain/scope.js';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JWT_AUDIENCE, JWT_ISSUER, type AccessPayload } from './jwt.strategy.js';
import { TotpService } from './totp.service.js';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const MFA_PENDING_SECONDS = 300;

interface MfaPendingPayload {
  sub: string;
  typ: 'mfa';
  stage: 'verify' | 'enroll';
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

export type LoginOutcome =
  | { result: Extract<LoginResult, { status: 'OK' }>; session: IssuedSession }
  | { result: Exclude<LoginResult, { status: 'OK' }>; mfaToken: string };

/** argon2id parameters (OWASP baseline). */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id as 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    private readonly clock: ClockService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Step 1: password. Returns a session, or an MFA challenge / enrolment. */
  async login(email: string, password: string): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const fail = async (reason: string) => {
      await this.audit.record({
        actor: user ? { id: user.id, role: user.role } : null,
        action: 'auth.login_failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        data: { email: maskEmail(email), reason },
      });
      return new UnauthorizedException('Invalid email or password');
    };

    if (!user || !user.active) {
      // Constant-ish time: still run a hash verification.
      await argon2.verify(DUMMY_HASH, password).catch(() => false);
      throw await fail('unknown_or_inactive');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw await fail('locked');
    }
    if (!(await argon2.verify(user.passwordHash, password))) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw await fail(failed >= MAX_FAILED_LOGINS ? 'bad_password_locked' : 'bad_password');
    }

    const mfaRequired = MFA_MANDATORY_ROLES.includes(user.role) || user.mfaEnabled;
    if (!mfaRequired) return { result: { status: 'OK' }, session: await this.issueSession(user) };

    if (user.mfaEnabled && user.mfaSecretEnc) {
      return {
        result: { status: 'MFA_REQUIRED' },
        mfaToken: this.signMfaPending(user.id, 'verify'),
      };
    }

    // Mandatory but not enrolled yet: start enrolment.
    const secret = this.totp.newSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: this.totp.encrypt(secret), mfaEnabled: false },
    });
    const otpauthUrl = this.totp.otpauthUrl(user.email, secret);
    return {
      result: {
        status: 'MFA_SETUP_REQUIRED',
        otpauthUrl,
        qrDataUrl: await this.totp.qrDataUrl(otpauthUrl),
        secret,
      },
      mfaToken: this.signMfaPending(user.id, 'enroll'),
    };
  }

  /** Step 2: TOTP code (verifies, or completes enrolment). */
  async verifyMfa(mfaToken: string | undefined, code: string): Promise<IssuedSession> {
    if (!mfaToken) throw new UnauthorizedException('MFA session expired, sign in again');
    let payload: MfaPendingPayload;
    try {
      payload = await this.jwt.verifyAsync<MfaPendingPayload>(mfaToken, {
        secret: this.config.JWT_ACCESS_SECRET,
        issuer: JWT_ISSUER,
        audience: 'nidhisetu-mfa',
      });
    } catch {
      throw new UnauthorizedException('MFA session expired, sign in again');
    }
    if (payload.typ !== 'mfa') throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user?.active || !user.mfaSecretEnc) throw new UnauthorizedException();

    const ok = await this.totp.check(this.totp.decrypt(user.mfaSecretEnc), code);
    if (!ok) {
      await this.audit.record({
        actor: { id: user.id, role: user.role },
        action: 'auth.mfa_failed',
        entityType: 'User',
        entityId: user.id,
      });
      throw new UnauthorizedException('Invalid authentication code');
    }
    if (payload.stage === 'enroll') {
      await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
      await this.audit.record({
        actor: { id: user.id, role: user.role },
        action: 'auth.mfa_enrolled',
        entityType: 'User',
        entityId: user.id,
      });
    }
    return this.issueSession(user);
  }

  /** Optional MFA for institution users: start enrolment while signed in. */
  async startOptionalMfa(principal: Principal) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.id } });
    const secret = this.totp.newSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecretEnc: this.totp.encrypt(secret), mfaEnabled: false },
    });
    const otpauthUrl = this.totp.otpauthUrl(user.email, secret);
    return { otpauthUrl, qrDataUrl: await this.totp.qrDataUrl(otpauthUrl), secret };
  }

  async confirmOptionalMfa(principal: Principal, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.id } });
    if (
      !user.mfaSecretEnc ||
      !(await this.totp.check(this.totp.decrypt(user.mfaSecretEnc), code))
    ) {
      throw new UnauthorizedException('Invalid authentication code');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await this.audit.record({
      actor: { id: user.id, role: user.role },
      action: 'auth.mfa_enrolled',
      entityType: 'User',
      entityId: user.id,
    });
  }

  async refresh(refreshToken: string | undefined): Promise<IssuedSession> {
    if (!refreshToken) throw new UnauthorizedException();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256Hex(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active) {
      throw new UnauthorizedException('Session expired');
    }
    // Rotate: the old refresh token is single-use.
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return this.issueSession(session.user, false);
  }

  async logout(refreshToken: string | undefined, principal?: Principal): Promise<void> {
    if (refreshToken) {
      await this.prisma.session.updateMany({
        where: { tokenHash: sha256Hex(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (principal) {
      await this.audit.record({
        actor: { id: principal.id, role: principal.role },
        action: 'auth.logout',
        entityType: 'User',
        entityId: principal.id,
      });
    }
  }

  async me(principal: Principal): Promise<Me> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.id },
      include: { region: true, institution: true, bank: true },
    });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      regionId: user.regionId,
      regionName: user.region?.name ?? null,
      institutionId: user.institutionId,
      institutionName: user.institution?.name ?? null,
      bankId: user.bankId,
      bankName: user.bank?.name ?? null,
      mfaEnabled: user.mfaEnabled,
      permissions: permissionsFor(user.role),
      demoMode: this.clock.demoMode,
      today: this.clock.todayIso(),
    };
  }

  private signMfaPending(userId: string, stage: MfaPendingPayload['stage']): string {
    const payload: MfaPendingPayload = { sub: userId, typ: 'mfa', stage };
    return this.jwt.sign(payload, {
      secret: this.config.JWT_ACCESS_SECRET,
      expiresIn: MFA_PENDING_SECONDS,
      issuer: JWT_ISSUER,
      audience: 'nidhisetu-mfa',
    });
  }

  private async issueSession(user: User, isLogin = true): Promise<IssuedSession> {
    const payload: AccessPayload = { sub: user.id, role: user.role, typ: 'access' };
    const accessToken = this.jwt.sign(payload, {
      secret: this.config.JWT_ACCESS_SECRET,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const refreshToken = randomToken(32);
    const ctx = RequestContext.get();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + this.config.JWT_REFRESH_TTL_SECONDS * 1000),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent?.slice(0, 200) ?? null,
      },
    });
    if (isLogin) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null, lastLoginAt: this.clock.now() },
      });
      await this.audit.record({
        actor: { id: user.id, role: user.role },
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
      });
    }
    return { accessToken, refreshToken };
  }
}

// argon2id hash of a random string, used to equalise timing for unknown users.
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$J6m3r0rQ8yYQe0QZ8Ff3nqFQ0WmE3xQhH6b8m6v4b1A';
