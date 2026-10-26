import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  CloseDiscrepancySchema,
  CommentSchema,
  DiscrepancyListQuerySchema,
  NoteSchema,
  OptionalNoteSchema,
  RaiseDiscrepancySchema,
  VerifyFieldsSchema,
  type CloseDiscrepancyInput,
  type CommentInput,
  type DiscrepancyListQuery,
  type NoteInput,
  type RaiseDiscrepancyData,
  type VerifyFieldsInput,
} from '@nidhisetu/shared';
import type { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod.js';
import type { Principal } from '../domain/scope.js';
import { DiscrepanciesService } from './discrepancies.service.js';
import { ScrutinyService } from './scrutiny.service.js';

const ok = { ok: true } as const;

@ApiTags('scrutiny')
@Controller('instruments/:id')
export class ScrutinyController {
  constructor(
    private readonly scrutiny: ScrutinyService,
    private readonly discrepancies: DiscrepanciesService,
  ) {}

  @RequirePermission('scrutiny:act')
  @Post('begin-scrutiny')
  @HttpCode(200)
  async begin(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.scrutiny.begin(u, id);
    return ok;
  }

  @RequirePermission('scrutiny:act')
  @Post('verify-fields')
  @HttpCode(200)
  @ApiZodBody(VerifyFieldsSchema)
  async verifyFields(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(VerifyFieldsSchema)) body: VerifyFieldsInput,
  ) {
    await this.scrutiny.verifyFields(u, id, body);
    return ok;
  }

  @RequirePermission('scrutiny:act')
  @Post('verify')
  @HttpCode(200)
  async verify(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.scrutiny.markVerified(u, id);
    return ok;
  }

  @RequirePermission('scrutiny:act')
  @Post('reject')
  @HttpCode(200)
  @ApiZodBody(NoteSchema)
  async reject(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(NoteSchema)) body: NoteInput,
  ) {
    await this.scrutiny.reject(u, id, body.note);
    return ok;
  }

  @RequirePermission('discrepancy:manage')
  @Post('discrepancies')
  @ApiZodBody(RaiseDiscrepancySchema)
  raise(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RaiseDiscrepancySchema)) body: RaiseDiscrepancyData,
  ) {
    return this.discrepancies.raise(u, id, body);
  }

  @RequirePermission('discrepancy:manage')
  @Post('return')
  @HttpCode(200)
  @ApiZodBody(OptionalNoteSchema)
  async returnToInstitution(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(OptionalNoteSchema)) body: z.infer<typeof OptionalNoteSchema>,
  ) {
    await this.discrepancies.returnToInstitution(u, id, body.note);
    return ok;
  }

  /** Institution has answered every open discrepancy and sends the instrument back for scrutiny. */
  @RequirePermission('discrepancy:respond')
  @Post('respond')
  @HttpCode(200)
  @ApiZodBody(OptionalNoteSchema)
  async respond(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(OptionalNoteSchema)) body: z.infer<typeof OptionalNoteSchema>,
  ) {
    await this.discrepancies.submitResponse(u, id, body.note);
    return ok;
  }
}

@ApiTags('discrepancies')
@Controller('discrepancies')
export class DiscrepanciesController {
  constructor(private readonly discrepancies: DiscrepanciesService) {}

  @RequirePermission('discrepancy:read')
  @Get()
  @ApiZodQuery(DiscrepancyListQuerySchema)
  list(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(DiscrepancyListQuerySchema)) q: DiscrepancyListQuery,
  ) {
    return this.discrepancies.list(u, q);
  }

  @RequirePermission('discrepancy:respond', 'discrepancy:manage')
  @Post(':id/comments')
  @ApiZodBody(CommentSchema)
  async comment(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(CommentSchema)) body: CommentInput,
  ) {
    await this.discrepancies.comment(u, id, body.body);
    return ok;
  }

  @RequirePermission('discrepancy:manage')
  @Post(':id/close')
  @HttpCode(200)
  @ApiZodBody(CloseDiscrepancySchema)
  async close(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(CloseDiscrepancySchema)) body: CloseDiscrepancyInput,
  ) {
    await this.discrepancies.close(u, id, body);
    return ok;
  }
}
