import { APP_NAME, APP_TAGLINE } from '@nidhisetu/shared';
import { fetchHealth } from '@/lib/api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const health = await fetchHealth();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-16">
      <header>
        <p className="text-sm font-medium uppercase tracking-wide text-brand-700">
          AICTE · Security Deposit / FDR Portal
        </p>
        <h1 className="mt-2 text-4xl font-bold text-brand-900">{APP_NAME}</h1>
        <p className="mt-2 text-lg text-slate-600">{APP_TAGLINE}</p>
      </header>

      <section aria-labelledby="status-heading" className="rounded-lg border bg-white p-4">
        <h2 id="status-heading" className="text-base font-semibold">
          System status
        </h2>
        <p className="mt-1 text-sm" role="status">
          API:{' '}
          {health ? (
            <span className="font-medium text-trust-bank">
              {health.status} (v{health.version})
            </span>
          ) : (
            <span className="font-medium text-trust-mismatch">unreachable</span>
          )}
        </p>
      </section>
    </main>
  );
}
