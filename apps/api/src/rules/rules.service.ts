import { Injectable } from '@nestjs/common';
import {
  RULE_CODES,
  RULE_DEFINITIONS,
  parseRuleConfig,
  type RuleCode,
  type RuleConfig,
} from '@nidhisetu/shared';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { ClockService } from '../clock/clock.service.js';
import { resolveRules, type RuleVersionLike } from '../domain/rules-engine.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type Db } from '../prisma/prisma.service.js';

export type RuleSet = { [C in RuleCode]: RuleConfig<C> };

const CACHE_MS = 5_000;

/** Versioned, DB-stored rules (Section 3.3), resolved as of the (demo) clock. */
@Injectable()
export class RulesService {
  private cache: { at: number; versions: RuleVersionLike[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
  ) {}

  private async versions(db: Db = this.prisma): Promise<RuleVersionLike[]> {
    // Rules change rarely and every change clears the cache, so reads inside transactions use it
    // too (each status change would otherwise re-read the whole rule table).
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.versions;
    const versions = await db.rule.findMany({
      select: { code: true, version: true, effectiveFrom: true, config: true },
    });
    if (db === this.prisma) this.cache = { at: Date.now(), versions };
    return versions;
  }

  /** All rules in force now (or at `at`). */
  async current(at: Date = this.clock.now(), db?: Db): Promise<RuleSet> {
    return resolveRules(await this.versions(db), at);
  }

  async get<C extends RuleCode>(code: C, at?: Date): Promise<RuleConfig<C>> {
    return (await this.current(at))[code];
  }

  /** Full history for the admin UI. */
  history() {
    return this.prisma.rule.findMany({ orderBy: [{ code: 'asc' }, { version: 'desc' }] });
  }

  /** Saves a new version (never edits an old one). Audited. */
  async publish(
    code: RuleCode,
    input: { config: unknown; effectiveFrom: Date; source: string; note?: string | null },
    actor: Actor,
    tx?: Prisma.TransactionClient,
  ) {
    const config = parseRuleConfig(code, input.config);
    const run = async (db: Prisma.TransactionClient) => {
      const last = await db.rule.findFirst({ where: { code }, orderBy: { version: 'desc' } });
      const rule = await db.rule.create({
        data: {
          code,
          type: RULE_DEFINITIONS[code].type,
          version: (last?.version ?? 0) + 1,
          config,
          effectiveFrom: input.effectiveFrom,
          source: input.source,
          note: input.note ?? null,
          createdById: actor.id,
          createdAt: this.clock.now(),
        },
      });
      await this.audit.record(
        {
          actor,
          action: 'rule.published',
          entityType: 'Rule',
          entityId: rule.id,
          data: {
            code,
            version: rule.version,
            effectiveFrom: input.effectiveFrom,
            source: input.source,
            previous: last?.config,
            config,
          },
        },
        db,
      );
      return rule;
    };
    this.cache = null;
    const rule = tx ? await run(tx) : await this.prisma.$transaction(run);
    this.cache = null;
    return rule;
  }

  static readonly CODES = RULE_CODES;
}
