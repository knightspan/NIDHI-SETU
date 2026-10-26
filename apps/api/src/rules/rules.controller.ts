import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RULE_CODES, RULE_DEFINITIONS, isoDate, type RuleCode } from '@nidhisetu/shared';
import { z } from 'zod';
import { CurrentUser, RequirePermission } from '../auth/decorators.js';
import { actorOf } from '../common/actor.js';
import { ApiZodBody, ZodPipe } from '../common/zod.js';
import { ClockService } from '../clock/clock.service.js';
import { dateOnly } from '../domain/dates.js';
import { NotFoundError } from '../domain/errors.js';
import { pickRuleVersion } from '../domain/rules-engine.js';
import type { Principal } from '../domain/scope.js';
import { RulesService } from './rules.service.js';

const PublishSchema = z.object({
  config: z.unknown(),
  effectiveFrom: isoDate,
  source: z.string().trim().min(3).max(300),
  note: z.string().trim().max(1000).optional(),
});

/** Versioned rules (Section 3.3): everyone with rule:read sees them, only SYS_ADMIN publishes. */
@ApiTags('rules')
@Controller('rules')
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly clock: ClockService,
  ) {}

  @RequirePermission('rule:read')
  @Get()
  async list() {
    const history = await this.rules.history();
    const now = this.clock.now();
    return RULE_CODES.map((code) => {
      const versions = history.filter((h) => h.code === code);
      const current = pickRuleVersion(versions, code, now);
      return {
        code,
        type: RULE_DEFINITIONS[code].type,
        current: current ?? null,
        scheduled: versions.filter((v) => v.effectiveFrom > now),
        history: versions,
        jsonSchema: z.toJSONSchema(RULE_DEFINITIONS[code].schema, { unrepresentable: 'any' }),
      };
    });
  }

  @RequirePermission('rule:manage')
  @Post(':code')
  @ApiZodBody(PublishSchema)
  publish(
    @CurrentUser() u: Principal,
    @Param('code') code: string,
    @Body(new ZodPipe(PublishSchema)) body: z.infer<typeof PublishSchema>,
  ) {
    if (!(RULE_CODES as string[]).includes(code)) throw new NotFoundError('Rule');
    return this.rules.publish(
      code as RuleCode,
      {
        config: body.config,
        // Effective from the start of that day, India time.
        effectiveFrom: new Date(dateOnly(body.effectiveFrom).getTime() - 330 * 60_000),
        source: body.source,
        note: body.note,
      },
      actorOf(u),
    );
  }
}
