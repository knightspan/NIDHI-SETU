'use client';

import { useTranslations } from 'next-intl';
import { PageHeader } from '@/components/ui/misc';
import { useMe } from '@/lib/session';

export default function DashboardPage() {
  const t = useTranslations('dashboard');
  const { data: me } = useMe();
  return (
    <PageHeader title={t('title')} description={me ? t('welcome', { name: me.name }) : undefined} />
  );
}
