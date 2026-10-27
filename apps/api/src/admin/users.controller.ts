import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ROLES, ROLE_SCOPE } from '@nidhisetu/shared';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { hashPassword } from '../auth/auth.service.js';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { InvalidInputError } from '../domain/errors.js';
import type { Principal } from '../domain/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

const PASSWORD = z
  .string()
  .min(12, 'At least 12 characters')
  .max(128)
  .regex(/[A-Z]/, 'Needs an upper-case letter')
  .regex(/[a-z]/, 'Needs a lower-case letter')
  .regex(/\d/, 'Needs a digit');

const CreateUserSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().min(2).max(120),
  role: z.enum(ROLES),
  password: PASSWORD,
  regionId: z.uuid().nullish(),
  institutionId: z.uuid().nullish(),
  bankId: z.uuid().nullish(),
  phone: z.string().max(20).nullish(),
});
type CreateUser = z.infer<typeof CreateUserSchema>;

const UpdateUserSchema = z.object({
  active: z.boolean().optional(),
  name: z.string().min(2).max(120).optional(),
});
type UpdateUser = z.infer<typeof UpdateUserSchema>;

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  name: true,
  role: true,
  active: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  region: { select: { id: true, name: true } },
  institution: { select: { id: true, name: true } },
  bank: { select: { id: true, name: true } },
} as const;

@ApiTags('admin')
@Controller('admin/users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission('user:manage')
  @Get()
  list() {
    return this.prisma.user.findMany({
      select: PUBLIC_FIELDS,
      orderBy: [{ role: 'asc' }, { email: 'asc' }],
    });
  }

  @RequirePermission('user:manage')
  @Post()
  @ApiZodBody(CreateUserSchema)
  async create(
    @CurrentUser() me: Principal,
    @Body(new ZodPipe(CreateUserSchema)) body: CreateUser,
  ) {
    const scope = ROLE_SCOPE[body.role];
    if (scope === 'INSTITUTION' && !body.institutionId)
      throw new InvalidInputError('institutionId required');
    if (scope === 'REGION' && !body.regionId) throw new InvalidInputError('regionId required');
    if (scope === 'BANK' && !body.bankId) throw new InvalidInputError('bankId required');
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: body.email,
          name: body.name,
          role: body.role,
          passwordHash: await hashPassword(body.password),
          regionId: scope === 'REGION' ? body.regionId : null,
          institutionId: scope === 'INSTITUTION' ? body.institutionId : null,
          bankId: scope === 'BANK' ? body.bankId : null,
          phone: body.phone ?? null,
        },
        select: PUBLIC_FIELDS,
      });
      await this.audit.record(
        {
          actor: actorOf(me),
          action: 'user.created',
          entityType: 'User',
          entityId: user.id,
          data: { role: user.role },
        },
        tx,
      );
      return user;
    });
  }

  @RequirePermission('user:manage')
  @Patch(':id')
  @ApiZodBody(UpdateUserSchema)
  async update(
    @CurrentUser() me: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(UpdateUserSchema)) body: UpdateUser,
  ) {
    if (id === me.id && body.active === false)
      throw new InvalidInputError('You cannot deactivate yourself');
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id }, data: body, select: PUBLIC_FIELDS });
      if (body.active === false) {
        await tx.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          actor: actorOf(me),
          action: 'user.updated',
          entityType: 'User',
          entityId: id,
          data: body,
        },
        tx,
      );
      return user;
    });
  }

  /** Forces the user to enrol a new authenticator at next sign-in. */
  @RequirePermission('user:manage')
  @Post(':id/reset-mfa')
  @HttpCode(200)
  async resetMfa(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
      await this.audit.record(
        { actor: actorOf(me), action: 'user.mfa_reset', entityType: 'User', entityId: id },
        tx,
      );
      return { ok: true };
    });
  }

  /**
   * Issues a one-time temporary password (shown once to the admin, never stored or logged in
   * clear). The user must replace it at next sign-in; existing sessions end now.
   */
  @RequirePermission('user:manage')
  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(@CurrentUser() me: Principal, @Param('id', ParseUUIDPipe) id: string) {
    if (id === me.id)
      throw new InvalidInputError('Change your own password from your account page');
    const temporaryPassword = `${randomBytes(12).toString('base64url')}7k`;
    const passwordHash = await hashPassword(temporaryPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null },
      });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(
        { actor: actorOf(me), action: 'user.password_reset', entityType: 'User', entityId: id },
        tx,
      );
    });
    return { temporaryPassword };
  }
}
