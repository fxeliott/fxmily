'use client';

import { Check, X } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

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
 *
 * Reject is irreversible (no email, no account, RGPD purge), so it uses the
 * same double-confirm guard as CardActionsRow's delete: 1st click arms
 * `confirmingReject` (label « Confirmer le refus ? », bad-dim tone, announced
 * via `aria-live`, auto-cancelled after 4s with `useEffect` cleanup so an
 * unmount during the window can't leak setState); 2nd click executes. Approve
 * stays a single click.
 */
export function AccessRequestRow({ id, fullName, email, dateLabel }: AccessRequestRowProps) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AccessRequestActionState | null>(null);
  const [resolved, setResolved] = useState(false);
  const [confirmingReject, setConfirmingReject] = useState(false);
  const [announce, setAnnounce] = useState('');
  const announceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-cancel the reject confirmation after 4s — useEffect ensures cleanup on
  // unmount (the row unmounts on approve success).
  useEffect(() => {
    if (!confirmingReject) return;
    const timer = setTimeout(() => setConfirmingReject(false), 4000);
    return () => clearTimeout(timer);
  }, [confirmingReject]);

  // Cleanup announce timeout on unmount.
  useEffect(() => {
    return () => {
      if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    };
  }, []);

  function announceFor(msg: string) {
    setAnnounce(msg);
    if (announceTimeoutRef.current) clearTimeout(announceTimeoutRef.current);
    // Clear after 1.5s so a re-announce of the same message will fire.
    announceTimeoutRef.current = setTimeout(() => setAnnounce(''), 1500);
  }

  function run(action: (requestId: string) => Promise<AccessRequestActionState>) {
    startTransition(async () => {
      const res = await action(id);
      setResult(res);
      if (res.ok) setResolved(true);
    });
  }

  function onApprove() {
    setConfirmingReject(false);
    run(approveAccessRequestAction);
  }

  function onReject() {
    if (!confirmingReject) {
      setConfirmingReject(true);
      announceFor(
        `Confirmation requise pour refuser la demande de ${fullName}. Clique à nouveau dans 4 secondes.`,
      );
      return;
    }
    run(rejectAccessRequestAction);
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
      {/* Live region for screen readers — announces the reject confirmation arm. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announce}
      </span>

      <div className="min-w-0 flex-1">
        <p className="t-h3 truncate text-[var(--t-1)]">{fullName}</p>
        <p className="t-cap mt-0.5 truncate text-[var(--t-3)]">{email}</p>
        <p className="t-mono-cap mt-1 text-[var(--t-4)]">{dateLabel}</p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Btn kind="primary" size="m" loading={pending} disabled={pending} onClick={onApprove}>
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} />
          Accepter
        </Btn>
        <Btn
          kind={confirmingReject ? 'danger' : 'ghost'}
          size="m"
          disabled={pending}
          aria-label={
            confirmingReject
              ? `Confirmer le refus de la demande de ${fullName}`
              : `Refuser la demande de ${fullName}`
          }
          onClick={onReject}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          {confirmingReject ? 'Confirmer le refus ?' : 'Refuser'}
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
