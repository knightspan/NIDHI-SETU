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
        'dp-stamp inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset',
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
    info: { cls: 'dp-alert-info', Icon: Info },
    success: { cls: 'dp-alert-success', Icon: CheckCircle2 },
    warning: { cls: 'dp-alert-warning', Icon: AlertTriangle },
    error: { cls: 'dp-alert-error', Icon: XCircle },
  }[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('dp-alert', map.cls, className)}
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
    <div role="status" className={cn('flex items-center gap-2 text-sm text-label', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label ?? t('loading')}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('dp-skeleton animate-pulse', className)} aria-hidden />;
}

export function EmptyState({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="dp-empty">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-label">{children}</div>}
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
      className={cn('dp-dialog', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div className="dp-panel flex max-h-[85vh] flex-col">
          <div className="dp-panel-head flex items-start justify-between gap-4 px-5 py-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-bold tracking-tight text-ink">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-label">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="dp-util dp-press h-9 w-9"
              aria-label={t('close')}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 px-5 py-3 shadow-[inset_0_1px_0_rgba(24,30,34,0.12)]">
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
    <div className="dp-pagehead">
      <div className="min-w-0">
        <h1 className="dp-page-title">{title}</h1>
        {description && <p className="dp-reading">{description}</p>}
      </div>
      {actions && <div className="dp-page-actions">{actions}</div>}
    </div>
  );
}
