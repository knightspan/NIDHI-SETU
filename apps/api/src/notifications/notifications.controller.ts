import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthenticatedOnly, CurrentUser } from '../auth/decorators.js';
import { ApiZodQuery, ZodPipe } from '../common/zod.js';
import type { Principal } from '../domain/scope.js';
import { PrismaService } from '../prisma/prisma.service.js';

const ListQuery = z.object({
  unread: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

/** The signed-in user's own notifications. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @AuthenticatedOnly()
  @Get()
  @ApiZodQuery(ListQuery)
  async list(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
  ) {
    const where = { userId: u.id, ...(q.unread === 'true' && { readAt: null }) };
    const [total, items] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          kind: true,
          title: true,
          body: true,
          link: true,
          channels: true,
          readAt: true,
          createdAt: true,
        },
      }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, items };
  }

  @AuthenticatedOnly()
  @Get('unread-count')
  async unread(@CurrentUser() u: Principal) {
    return {
      unread: await this.prisma.notification.count({ where: { userId: u.id, readAt: null } }),
    };
  }

  @AuthenticatedOnly()
  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId: u.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @AuthenticatedOnly()
  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() u: Principal) {
    const r = await this.prisma.notification.updateMany({
      where: { userId: u.id, readAt: null },
      data: { readAt: new Date() },
    });
    return { ok: true, updated: r.count };
  }
}
