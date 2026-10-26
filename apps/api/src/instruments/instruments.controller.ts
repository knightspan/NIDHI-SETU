import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  InstrumentDeclarationSchema,
  InstrumentListQuerySchema,
  type InstrumentDeclaration,
  type InstrumentDetail,
  type InstrumentListQuery,
  type InstrumentSummary,
  type Paged,
} from '@nidhisetu/shared';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod.js';
import type { Principal } from '../domain/scope.js';
import { InstrumentsService } from './instruments.service.js';

@ApiTags('instruments')
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instruments: InstrumentsService) {}

  @RequirePermission('instrument:read')
  @Get()
  @ApiZodQuery(InstrumentListQuerySchema)
  list(
    @CurrentUser() user: Principal,
    @Query(new ZodPipe(InstrumentListQuerySchema)) q: InstrumentListQuery,
  ): Promise<Paged<InstrumentSummary>> {
    return this.instruments.list(user, q);
  }

  /** Bank officers may open instruments addressed to their bank (scoping handles the rest). */
  @RequirePermission('instrument:read', 'bank:respond')
  @Get(':id')
  detail(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InstrumentDetail> {
    return this.instruments.detail(user, id);
  }

  @RequirePermission('instrument:write_own')
  @Post()
  @ApiZodBody(InstrumentDeclarationSchema)
  create(
    @CurrentUser() user: Principal,
    @Body(new ZodPipe(InstrumentDeclarationSchema)) body: InstrumentDeclaration,
  ) {
    return this.instruments.create(user, body);
  }

  @RequirePermission('instrument:write_own')
  @Patch(':id')
  @ApiZodBody(InstrumentDeclarationSchema)
  async update(
    @CurrentUser() user: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(InstrumentDeclarationSchema)) body: InstrumentDeclaration,
  ) {
    await this.instruments.updateDeclared(user, id, body);
    return { ok: true };
  }

  @RequirePermission('instrument:write_own')
  @Post(':id/submit')
  @HttpCode(200)
  async submit(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.instruments.submit(user, id);
    return { ok: true };
  }

  @RequirePermission('instrument:write_own')
  @Delete(':id')
  async remove(@CurrentUser() user: Principal, @Param('id', ParseUUIDPipe) id: string) {
    await this.instruments.deleteDraft(user, id);
    return { ok: true };
  }
}
