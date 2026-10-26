'use client';

import { useParams } from 'next/navigation';
import { ActionBar } from '@/components/instrument/action-bar';
import { DocumentsPanel } from '@/components/instrument/documents-panel';
import { FieldsPanel } from '@/components/instrument/fields-panel';
import { InstrumentHeader } from '@/components/instrument/header';
import { InstitutionCard } from '@/components/instrument/institution-card';
import { ChainPanel, TimelinePanel } from '@/components/instrument/timeline-panel';
import { useInstrument } from '@/components/instrument/use-instrument';
import { Alert, Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api-client';

export default function InstrumentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: inst, error } = useInstrument(id);
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!inst) return <Spinner />;

  return (
    <div className="space-y-4">
      <InstrumentHeader inst={inst} />
      <ChainPanel inst={inst} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <FieldsPanel inst={inst} />
          <DocumentsPanel inst={inst} />
        </div>
        <div className="space-y-4">
          <ActionBar inst={inst} />
          <InstitutionCard inst={inst} />
          <TimelinePanel inst={inst} />
        </div>
      </div>
    </div>
  );
}
