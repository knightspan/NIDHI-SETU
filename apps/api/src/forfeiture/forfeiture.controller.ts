import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ForfeitureExecuteSchema,
  ForfeitureProposeSchema,
  NoteSchema,
  type ForfeitureExecuteInput,
  type ForfeitureProposeInput,
  type NoteInput,
} from '@nidhisetu/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import type { Principal } from '../domain/scope.js';
import { ForfeitureService } from './forfeiture.service.js';

const ListQuery = z.object({ open: z.enum(['true', 'false']).default('true') });

@ApiTags('forfeiture')
@Controller()
export class ForfeitureController {
  constructor(private readonly forfeiture: ForfeitureService) {}

  @RequirePermission('instrument:read')
  @Get('forfeitures')
  list(@CurrentUser() u: Principal, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.forfeiture.list(u, q.open === 'true');
  }

  @RequirePermission('forfeiture:propose')
  @Post('instruments/:id/forfeiture')
  @ApiZodBody(ForfeitureProposeSchema)
  propose(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ForfeitureProposeSchema)) body: ForfeitureProposeInput,
  ) {
    return this.forfeiture.propose(u, id, body);
  }

  @RequirePermission('forfeiture:approve')
  @Post('forfeitures/:id/approve')
  @HttpCode(200)
  @ApiZodBody(NoteSchema)
  approve(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(NoteSchema)) body: NoteInput,
  ) {
    return this.forfeiture.approve(u, id, body.note);
  }

  @RequirePermission('forfeiture:approve')
  @Post('forfeitures/:id/reject')
  @HttpCode(200)
  @ApiZodBody(NoteSchema)
  reject(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(NoteSchema)) body: NoteInput,
  ) {
    return this.forfeiture.reject(u, id, body.note);
  }

  @RequirePermission('forfeiture:execute')
  @Post('forfeitures/:id/execute')
  @HttpCode(200)
  @ApiZodBody(ForfeitureExecuteSchema)
  execute(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ForfeitureExecuteSchema)) body: ForfeitureExecuteInput,
  ) {
    return this.forfeiture.execute(u, id, body);
  }
}
