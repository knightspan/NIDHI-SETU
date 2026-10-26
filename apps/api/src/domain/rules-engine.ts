import { RULE_CODES, parseRuleConfig, type RuleCode, type RuleConfig } from '@nidhisetu/shared';

export interface RuleVersionLike {
  code: string;
  version: number;
  effectiveFrom: Date;
  config: unknown;
}

/**
 * The version of a rule in force at `at`: the highest version whose effective date has passed.
 * Versions dated in the future are scheduled and ignored until then.
 */
export function pickRuleVersion<T extends RuleVersionLike>(
  versions: readonly T[],
  code: string,
  at: Date,
): T | undefined {
  return versions
    .filter((v) => v.code === code && v.effectiveFrom.getTime() <= at.getTime())
    .sort((a, b) => b.version - a.version)[0];
}

export class MissingRuleError extends Error {
  constructor(code: string) {
    super(`No version of rule "${code}" is in force`);
  }
}

/** Resolves and validates every rule in force at `at`. */
export function resolveRules(
  versions: readonly RuleVersionLike[],
  at: Date,
): { [C in RuleCode]: RuleConfig<C> } {
  const out = {} as { [C in RuleCode]: RuleConfig<C> };
  for (const code of RULE_CODES) {
    const v = pickRuleVersion(versions, code, at);
    if (!v) throw new MissingRuleError(code);
    (out as Record<RuleCode, unknown>)[code] = parseRuleConfig(code, v.config);
  }
  return out;
}
