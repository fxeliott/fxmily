'use client';

import { Check, X } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  approveAccessRequestAction,
  rejectAccessRequestAction,
  type AccessRequestActionState,
} from '@/app/admin/access-requests/actions';
import { Alert } from '@/components/alert';
import { Btn } from '@/components/ui/btn';
import { Card } from '@/components/ui/card';

interface AccessRequestRowProps {
  id: string;
  fullName: string;
  email: string;
  /** Localized "il y a X" / date label, formatted server-side (no hydration drift). */
  dateLabel: string;
}

/**
 * One pending access request with Approve + Reject controls (V2.5 admin queue).
 *
 * Client island: the actions take a `requestId` argument (not FormData), so we
 * drive them with `useTransition` + a tiny local result banner. On success the
 * row resolves (the server `revalidatePath` removes it from the list on the
 * next render; we also collapse it locally for instant feedback).
 */
export function AccessRequestRow({ id, fullName, email, dateLabel }: AccessRequestRowProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AccessRequestActionState | null>(null);
  const [resolved, setResolved] = useState(false);

  function run(action: (requestId: string) => Promise<AccessRequestActionState>) {
    startTransition(async () => {
      const res = await action(id);
      setResult(res);
      if (res.ok) setResolved(true);
    });
  }

  if (resolved && result?.ok) {
    return (
      <Card className="p-4">
        <Alert tone="success">{result.message ?? 'Demande traitée.'}</Alert>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <p className="t-h3 truncate text-[var(--t-1)]">{fullName}</p>
        <p className="t-cap mt-0.5 truncate text-[var(--t-3)]">{email}</p>
        <p className="t-mono-cap mt-1 text-[var(--t-4)]">{dateLabel}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Btn
          kind="primary"
          size="m"
          loading={pending}
          disabled={pending}
          onClick={() => run(approveAccessRequestAction)}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          Accepter
        </Btn>
        <Btn
          kind="ghost"
          size="m"
          disabled={pending}
          onClick={() => run(rejectAccessRequestAction)}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          Refuser
        </Btn>
      </div>

      {!result?.ok && result?.message ? (
        <div className="sm:basis-full">
          <Alert tone="danger">{result.message}</Alert>
        </div>
      ) : null}
    </Card>
  );
}
