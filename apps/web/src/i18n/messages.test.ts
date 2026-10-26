import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIFECYCLE_STATUSES, ROLES, TRUST_LEVELS, VALIDITY_STATUSES } from '@nidhisetu/shared';

type Tree = { [k: string]: string | Tree };

function load(locale: string): Tree {
  return JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, `../../messages/${locale}.json`), 'utf8'),
  ) as Tree;
}

function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

function placeholders(s: string): string[] {
  // ICU arguments only: `{name}` or `{name, plural …}` — not plural branch text like `{No offset}`.
  return [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]!).sort();
}

describe('i18n message catalogues', () => {
  const en = load('en');
  const hi = load('hi');

  it('have identical keys in English and Hindi', () => {
    expect(keys(hi).sort()).toEqual(keys(en).sort());
  });

  it('use the same placeholders in both languages', () => {
    const get = (t: Tree, k: string) =>
      k.split('.').reduce<string | Tree>((acc, p) => (acc as Tree)[p]!, t) as string;
    for (const k of keys(en))
      expect([k, placeholders(get(hi, k))]).toEqual([k, placeholders(get(en, k))]);
  });

  it('translate every role, lifecycle status, validity status and trust level', () => {
    const all = new Set(keys(en));
    for (const r of ROLES) expect(all.has(`roles.${r}`)).toBe(true);
    for (const s of LIFECYCLE_STATUSES) expect(all.has(`lifecycle.${s}`)).toBe(true);
    for (const s of VALIDITY_STATUSES) expect(all.has(`validity.${s}`)).toBe(true);
    for (const s of TRUST_LEVELS) expect(all.has(`trust.${s}`)).toBe(true);
  });
});
