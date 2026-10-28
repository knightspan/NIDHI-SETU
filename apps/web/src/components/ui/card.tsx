import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({
  className,
  tone = 'raised',
  ...props
}: ComponentProps<'div'> & { tone?: 'raised' | 'screen' }) {
  return <div className={cn(tone === 'screen' ? 'dp-screen' : 'dp-panel', className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
  as: Heading = 'h2',
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  as?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <div
      className={cn(
        'dp-panel-head flex flex-wrap items-start justify-between gap-3 px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-base font-bold tracking-tight text-ink">{title}</Heading>
        {description && <p className="mt-0.5 text-sm text-label">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...props} />;
}
