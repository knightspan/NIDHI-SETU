'use client';

import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Badge({
  className,
  tone = 'slate',
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: 'slate' | 'blue' | 'amber' | 'green' | 'red' | 'purple' | 'brand';
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-800 ring-slate-300',
    blue: 'bg-blue-50 text-blue-800 ring-blue-300',
    amber: 'bg-amber-50 text-amber-900 ring-amber-300',
    green: 'bg-green-50 text-green-800 ring-green-300',
    red: 'bg-red-50 text-red-800 ring-red-300',
    purple: 'bg-purple-50 text-purple-800 ring-purple-300',
    brand: 'bg-brand-50 text-brand-900 ring-brand-600/30',
  } as const;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const map = {
    info: { cls: 'border-blue-200 bg-blue-50 text-blue-900', Icon: Info },
    success: { cls: 'border-green-200 bg-green-50 text-green-900', Icon: CheckCircle2 },
    warning: { cls: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle },
    error: { cls: 'border-red-200 bg-red-50 text-red-900', Icon: XCircle },
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-md border p-3 text-sm', map.cls, className)}
    >
      <map.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label, className }: { label?: string; className?: string }) {
  const t = useTranslations('common');
  return (
    <div role="status" className={cn('flex items-center gap-2 text-sm text-slate-600', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label ?? t('loading')}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-200', className)} aria-hidden />;
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center">
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-600">{children}</div>}
    </div>
  );
}

/** Modal dialog built on the native <dialog> element (focus trapping and Esc handled by the browser). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations('common');
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
      className={cn(
        'm-auto w-[calc(100%-2rem)] rounded-lg border border-slate-200 p-0 shadow-xl backdrop:bg-slate-900/40',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-semibold text-slate-900">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-600"
              aria-label={t('close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
