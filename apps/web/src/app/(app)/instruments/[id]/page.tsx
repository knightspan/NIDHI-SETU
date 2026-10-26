'use client';

import { useParams } from 'next/navigation';
import { ActionBar } from '@/components/instrument/action-bar';
import { BankPanel } from '@/components/instrument/bank-panel';
import { DiscrepanciesPanel } from '@/components/instrument/discrepancies-panel';
import { DocumentsPanel } from '@/components/instrument/documents-panel';
import { FieldsPanel } from '@/components/instrument/fields-panel';
import { InstrumentHeader } from '@/components/instrument/header';
import { InstitutionCard } from '@/components/instrument/institution-card';
import { ScrutinyWorkspace } from '@/components/instrument/scrutiny-workspace';
import { ChainPanel, TimelinePanel } from '@/components/instrument/timeline-panel';
import { useInstrument } from '@/components/instrument/use-instrument';
import { Alert, Spinner } from '@/components/ui/misc';
import { errorMessage } from '@/lib/api-client';
import { can, useMe } from '@/lib/session';

export default function InstrumentPage() {
  const { id } = useParams<{ id: string }>();
  const { data: me } = useMe();
  const { data: inst, error } = useInstrument(id);
  if (error) return <Alert tone="error">{errorMessage(error)}</Alert>;
  if (!inst) return <Spinner />;

  // The officer's side-by-side workspace while the instrument is being scrutinised.
  const workspace = inst.allowedActions.includes('verify_field');
  const showDiscrepancies = can(me, 'discrepancy:read') || inst.discrepancies.length > 0;

  return (
    <div className="space-y-4">
      <InstrumentHeader inst={inst} />
      <ChainPanel inst={inst} />
      {workspace && <ScrutinyWorkspace inst={inst} />}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {!workspace && <FieldsPanel inst={inst} />}
          {showDiscrepancies && <DiscrepanciesPanel inst={inst} />}
          <BankPanel inst={inst} canRetry={can(me, 'bank:request')} />
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
