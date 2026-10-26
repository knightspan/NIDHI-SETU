import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ExecuteReleaseSchema,
  ReleaseDecisionSchema,
  ReleaseListQuerySchema,
  RequestReleaseSchema,
  type ExecuteReleaseInput,
  type ReleaseDecisionInput,
  type ReleaseListQuery,
  type RequestReleaseInput,
} from '@nidhisetu/shared';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { ApiZodBody, ApiZodQuery, ZodPipe } from '../common/zod.js';
import type { Principal } from '../domain/scope.js';
import { ReleasesService } from './releases.service.js';

@ApiTags('releases')
@Controller()
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  /** Checklist preview before requesting. */
  @RequirePermission('release:request', 'release:recommend', 'instrument:read')
  @Get('instruments/:id/release-checklist')
  preview(@CurrentUser() u: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.releases.preview(u, id);
  }

  @RequirePermission('release:request')
  @Post('instruments/:id/release')
  @ApiZodBody(RequestReleaseSchema)
  request(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(RequestReleaseSchema)) body: RequestReleaseInput,
  ) {
    return this.releases.request(u, id, body.reason);
  }

  @RequirePermission('instrument:read')
  @Get('releases')
  @ApiZodQuery(ReleaseListQuerySchema)
  list(
    @CurrentUser() u: Principal,
    @Query(new ZodPipe(ReleaseListQuerySchema)) q: ReleaseListQuery,
  ) {
    return this.releases.list(u, q);
  }

  @RequirePermission('release:recommend')
  @Post('releases/:id/recommend')
  @HttpCode(200)
  @ApiZodBody(ReleaseDecisionSchema)
  recommend(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ReleaseDecisionSchema)) body: ReleaseDecisionInput,
  ) {
    return this.releases.recommend(u, id, body.note);
  }

  @RequirePermission('release:recommend')
  @Post('releases/:id/decline')
  @HttpCode(200)
  @ApiZodBody(ReleaseDecisionSchema)
  decline(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ReleaseDecisionSchema)) body: ReleaseDecisionInput,
  ) {
    return this.releases.decline(u, id, body.note);
  }

  @RequirePermission('release:approve')
  @Post('releases/:id/approve')
  @HttpCode(200)
  @ApiZodBody(ReleaseDecisionSchema)
  approve(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ReleaseDecisionSchema)) body: ReleaseDecisionInput,
  ) {
    return this.releases.approve(u, id, body.note);
  }

  @RequirePermission('release:approve')
  @Post('releases/:id/reject')
  @HttpCode(200)
  @ApiZodBody(ReleaseDecisionSchema)
  reject(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ReleaseDecisionSchema)) body: ReleaseDecisionInput,
  ) {
    return this.releases.rejectByAuthority(u, id, body.note);
  }

  @RequirePermission('release:execute')
  @Post('releases/:id/execute')
  @HttpCode(200)
  @ApiZodBody(ExecuteReleaseSchema)
  execute(
    @CurrentUser() u: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(ExecuteReleaseSchema)) body: ExecuteReleaseInput,
  ) {
    return this.releases.execute(u, id, body);
  }
}
