import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

type Hook = () => Promise<void>;
type TxFn<R> = (tx: Prisma.TransactionClient) => Promise<R>;
type TxOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

/**
 * Connection settings for Prisma's pg adapter. The adapter exchanges timestamps without a zone, so
 * the session must be UTC; otherwise a server in another time zone (e.g. Asia/Kolkata) stores every
 * instant shifted by its offset, which raw SQL, reports and backups would then see.
 */
export function pgAdapter(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
}

/** Work to run at the end of an interactive transaction, just before it commits. */
const preCommit = new WeakMap<object, Hook[]>();

/**
 * Registers `hook` to run when the transaction's callback has finished, still inside the
 * transaction. Returns false when `tx` was not opened through PrismaService (run it now instead).
 */
export function beforeCommit(tx: Prisma.TransactionClient, hook: Hook): boolean {
  const hooks = preCommit.get(tx);
  if (!hooks) return false;
  hooks.push(hook);
  return true;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  /** Development aid: with PRISMA_QUERY_STATS=1, counts queries (used by seed profiling). */
  static queryCount = 0;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: pgAdapter(config.DATABASE_URL),
      ...(process.env.PRISMA_QUERY_STATS
        ? { log: [{ emit: 'event' as const, level: 'query' as const }] }
        : {}),
    });
    if (process.env.PRISMA_QUERY_STATS)
      (this as unknown as { $on: (e: 'query', cb: () => void) => void }).$on('query', () => {
        PrismaService.queryCount++;
      });

    // Interactive transactions run their pre-commit hooks (e.g. audit appends) at the very end, so
    // the audit chain's advisory lock is held only for the last few statements of a transaction.
    const original = this.$transaction.bind(this) as unknown as (
      arg: unknown,
      opts?: TxOptions,
    ) => Promise<unknown>;
    const wrapped = (arg: unknown, opts?: TxOptions): Promise<unknown> => {
      if (typeof arg !== 'function') return original(arg, opts);
      const fn = arg as TxFn<unknown>;
      return original(async (tx: Prisma.TransactionClient) => {
        preCommit.set(tx, []);
        const result = await fn(tx);
        const hooks = preCommit.get(tx)!;
        for (let h = hooks.shift(); h; h = hooks.shift()) await h();
        return result;
      }, opts);
    };
    Object.defineProperty(this, '$transaction', { value: wrapped, configurable: true });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/** Either the root client or an interactive-transaction client. */
export type Db = PrismaService | Prisma.TransactionClient;
