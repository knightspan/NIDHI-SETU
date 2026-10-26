'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/form';
import { Dialog } from '@/components/ui/misc';

/** Confirmation dialog, optionally asking for a note (required notes are validated). */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  variant = 'primary',
  note,
  loading,
  onConfirm,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  variant?: ButtonProps['variant'];
  note?: { label: string; required?: boolean; minLength?: number };
  loading?: boolean;
  onConfirm: (note: string) => void;
  children?: ReactNode;
}) {
  const t = useTranslations('common');
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (open) {
      setText('');
      setError(undefined);
    }
  }, [open]);

  const confirm = () => {
    const min = note?.minLength ?? (note?.required ? 3 : 0);
    if (note && text.trim().length < min) {
      setError(t('required'));
      return;
    }
    onConfirm(text.trim());
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant={variant} loading={loading} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {note && (
        <Field
          label={note.label}
          required={note.required}
          error={error}
          className={children ? 'mt-4' : undefined}
        >
          {(p) => (
            <Textarea {...p} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </Field>
      )}
    </Dialog>
  );
}
